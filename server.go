package main

// Salesforce.com oauth2.0 & query proxy server

import (
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"io/ioutil"
	"log"
	"net/http"
	"net/url"
	"os"
	"sync"
	"text/template"

	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
}

func socketHandler(w http.ResponseWriter, r *http.Request) {
	v := r.URL.Query()
	token := v.Get("token")
	if token == "" {
		token = newCode()
	}
	conn, err := upgrader.Upgrade(w, r, nil)
	conns[token] = conn
	if err != nil {
		log.Println(err)
		return
	}
	fmt.Printf("Connected for %s\n", token)
	conn.WriteMessage(websocket.TextMessage, []byte(token))
	// fmt.Fprint(w, "You're here")
}

// Should build up pushing, socket.io type of stuff

var memory map[string]string
var conns map[string]*websocket.Conn
var lock sync.Mutex

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	memory = make(map[string]string)
	conns = make(map[string]*websocket.Conn)

	fs := http.FileServer(http.Dir("static"))
	http.Handle("/", fs)

	http.HandleFunc("/token", requestToken)

	http.HandleFunc("/auth_callback", returnauth)

	http.HandleFunc("/index.html", serveHome)

	http.HandleFunc("/ws", socketHandler)

	http.HandleFunc("/complete_auth", getauthwithtoken)

	http.HandleFunc("/api/query", sfdcQuery)

	log.Fatal(http.ListenAndServe(":"+port, httplog(http.DefaultServeMux)))

}

func httplog(handler http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		log.Printf("%s %s %s", r.RemoteAddr, r.Method, r.URL)
		handler.ServeHTTP(w, r)
	})
}

func sfdcQuery(w http.ResponseWriter, r *http.Request) {
	v := r.URL.Query()
	q := v.Get("q")
	req, err := http.NewRequest(r.Method, q, nil)
	// Forward headers
	req.Header.Add("Authorization", r.Header.Get("Authorization"))
	req.Header.Add("accept", r.Header.Get("accept"))

	client := &http.Client{}
	log.Printf("Starting Request to SFDC with query: %s\n", q)
	resp, err := client.Do(req)
	// dump, err := httputil.DumpResponse(resp, false)
	// log.Printf("Request****\n%s", string(dump))
	log.Println("Returned from SFDC")
	if err != nil {
		// TODO: Fail better
		log.Println("Error in request")
		fmt.Fprint(w, err)
		return
	}
	log.Printf("SFDC Response Code:%d\n", resp.StatusCode)

	// Migrate header data from Salesforce response for return to client
	for key, val := range resp.Header {
		for _, data := range val {
			w.Header().Add(key, data)
		}
	}

	contents, err := ioutil.ReadAll(resp.Body)
	if err != nil {
		log.Println("Error in body")
		fmt.Fprint(w, err)
		return
	}

	w.WriteHeader(resp.StatusCode)
	//fmt.Fprint(w, contents)
	w.Write(contents)

}

func requestToken(w http.ResponseWriter, r *http.Request) {
	// Set location to websocket page
	// Should return nicely packaged JSON object
	fmt.Fprint(w, newCode())

}

func newCode() string {
	// TODO: prevent duplicate code generation, big security concern
	size := 16 // change the length of the generated random string here

	rb := make([]byte, size)
	_, err := rand.Read(rb)

	if err != nil {
		fmt.Println(err)
	}

	// Should expire tokens
	rs := base64.URLEncoding.EncodeToString(rb)
	lock.Lock()
	memory[rs] = ""
	lock.Unlock()
	return rs
}

func returnauth(w http.ResponseWriter, r *http.Request) {
	v := r.URL.Query()
	code := v.Get("code")
	state := v.Get("state")
	log.Println("Aquiring SFDC Auth")
	sfdcAuth, err := getSalesforceAuth(code)
	log.Println("Returned from SFDC Auth")
	if err != nil {
		updateCode("{error: \"error getting auth\"}", state)
		log.Printf("Error getting auth: %s\n", err)
	} else {
		updateCode(sfdcAuth, state)
	}

	if conns[state] != nil {
		// TODO: harden for concurrency
		conn := conns[state]
		delete(conns, state)
		deleteCode(state)
		conn.WriteMessage(websocket.TextMessage, []byte(code))
		conn.Close()
	} else {
		log.Printf("no connection at %s\n", state)
	}
	fmt.Fprintf(w, "Thanks! State:%s, Code:%s", state, sfdcAuth)
}

func getSalesforceAuth(authToken string) (string, error) {
	v := url.Values{}
	v.Set("code", authToken)
	v.Set("grant_type", "authorization_code")
	v.Set("client_id", "3MVG9KI2HHAq33Ry8Vv4AYur3JeQQA.QC64MANBpo0n6HAdNfk5OZsAWrqMrIcue6bMjF3RsGaM0yQKzIvLtA")
	v.Set("client_secret", "8498989734413345550")
	v.Set("redirect_uri", "http://localhost:8080/auth_callback")
	v.Set("format", "json")

	client := &http.Client{}
	response, err := client.PostForm("https://login.salesforce.com/services/oauth2/token", v)
	if err != nil {
		return "", err
	}

	defer response.Body.Close()
	contents, err := ioutil.ReadAll(response.Body)
	if err != nil {
		return "", err
	}

	log.Println(string(contents))
	return string(contents), nil

}

func updateCode(code string, state string) {
	log.Printf("Update code **%s** with auth **%s**\n", state, code)
	lock.Lock()
	memory[state] = code
	lock.Unlock()
}

func deleteCode(state string) {
	lock.Lock()
	delete(memory, state)
	lock.Unlock()
}

func getauthwithtoken(w http.ResponseWriter, r *http.Request) {
	v := r.URL.Query()
	token := v.Get("token")
	log.Printf("Call for auth with token: %s\n", token)
	fmt.Fprint(w, getCode(token))

}

func getCode(token string) string {
	lock.Lock()
	var auth string
	if val, ok := memory[token]; ok {
		auth = val
	}
	lock.Unlock()
	fmt.Println(auth)
	fmt.Println(token)

	return auth
}

var homeTempl = template.Must(template.ParseFiles("index.html"))

func serveHome(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/index.html" {
		http.Error(w, "Not found", 404)
		return
	}
	if r.Method != "GET" {
		http.Error(w, "Method not allowed", 405)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	homeTempl.Execute(w, r.Host)
}
