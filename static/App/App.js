// TODO: hover for more information like API name, data type, etc...
// TODO: Image needed for search bar
// TODO: Need my own server, must investigate query functions. Do I really need to proxy all requests?
// TODO: Settings, what settings are allowed? Control batch size maybe?
// TODO: relationship traversal, how to present field names through relationships?
// TODO: children, how to handle children/nested/related list data, raw JSON??
// TODO: multiple login handling, several accounts concurrently or at least the ability to login to a different account
// TODO: deal with large size better
// TODO: ability to flush cache & improved cache storage for object describes (long-term storage somewhere??)
// TODO: Progress spinner, "I'm working here"

var keepMe = {};
var keepMeFields = {};

var app = (function () {
    'use strict';

	//var cid = "3MVG9KI2HHAq33RwNhhQSjqy7NxjoavGDbHPGE1KwK.rZk5pdB4.NyPBNUhyp3LtX6BGKL6C2bCw9aAedVR3F";
	//var proxy_address = "https://o365workshop.azurewebsites.net";
	var cid = "3MVG9KI2HHAq33Ry8Vv4AYur3JeQQA.QC64MANBpo0n6HAdNfk5OZsAWrqMrIcue6bMjF3RsGaM0yQKzIvLtA";
	var proxy_address = "https://force-com-data.herokuapp.com";
	var loginurl = "https://login.salesforce.com";
	var signalId = null;
	var myToken = null;
	var version = "34.0";
	var objectMap = {};
	var selectedFields = [];
	var baseObject;
	var select_fields = '';
	var headers = [];
	var officeTable;
	var currentRow = 1;
	var limitStep = 1000;
    var sortWaitTime = 750; // MS
	var celldatalimit = 20000; // Total number of cells per-write. Rows/columns must be less than or equal to this number
	var describeCacheStatus = {}; // Have we gotten the object describe data back from Salesforce yet? Did we even ask for it yet?
	// ADDED, REQUESTED, COMPLETE, ERROR

	var app = {};

    // Common initialization function (to be called from each page)
    app.initialize = function () {

        $('body').append(
			'<div id="notification-message">' +
				'<div class="padding">' +
					'<div id="notification-message-close"></div>' +
					'<div id="notification-message-header"></div>' +
					'<div id="notification-message-body"></div>' +
				'</div>' +
			'</div>');

        $('#notification-message-close').click(function () {
            $('#notification-message').hide();
        });


        // After initialization, expose a common notification function
        app.showNotification = function (header, text) {
            $('#notification-message-header').text(header);
            $('#notification-message-body').text(text);
            $('#notification-message').slideDown('fast');
        };
		app.setupSalesforce();
		//app.setupLogin();
    };

	// TODO: investigate performance impact around keyup, probably delay for one or two seconds to run less often
    app.searchList = function(){
		var searchBox = $(this);
		$('.option').each(function(index){
			var me = $(this);
			// If search box has text and that text is inside of the label of the object
			if(searchBox.val().length < 1 || me.text().toLocaleLowerCase().indexOf(searchBox.val().toLocaleLowerCase()) >= 0)
				me.removeClass("hidden");
			else
				me.addClass("hidden");
		});
	}

	app.setupLogin = function(){
		// Optimize path so we can't login before we have a token
		$('#content-header').html('Login to get started');
		// Init salesforce JS from external server

		var content = $('#content-main');
		// clear content-main
		content.html('');
		// creat login buttons
		var b = document.createElement("button");
		b = $(b);
		b.text('Login to Production/Developer');
		b.click(function(){
			app.loginToSalesforce('https://login.salesforce.com');
        });
		content.append(b);

		b = document.createElement("button");
		b = $(b);
		b.text('Login to Test');
		b.click(function(){
			app.loginToSalesforce('https://test.salesforce.com');
        });

		content.append(b);
	}

	app.setupSalesforce = function(){
		// Setup login return function
		app.buildForceStuff(app.listItems);
	}

	app.listItems = function(token){
		// capture the session token, possible cache and re-use
		if (token !== null){
			myToken = token;
		} else {
            app.showNotification('Error', 'Error establishing connection to Salesforce');
			// TODO: reset, recover
			return;
		}

		var content = $('#content-main');
		// clear content-main
		content.html('');

		var search = document.createElement('input');
		search.id = 'search-box';
		search.type = 'text';
		search.className = 'search-box';
		search.placeholder = 'Filter';
		content.append(search);
		$('#search-box').keyup(app.searchList);

		$('#content-header').html('Select starting object');


        //sign-in and get data from Salesforce

        //execute the REST query against Salesforce
        console.log("sent for sObjects");
        $.ajax({
            url: myToken.instance_url + "/services/data/v"+version+"/sobjects/",
            headers: {
                "Authorization": "Bearer " + myToken.access_token,
                "accept": "application/json;odata=verbose"
            },
            success: function (data) {
                //loop through the returned records and append to the officeTable
				keepMe = data;
        console.log("returned");
				data.sobjects = app.sortByKey(data.sobjects, "label");
                $(data.sobjects).each(function(row_index, row) {

					var e = document.createElement('div');
					e = $(e);
					e.text(row.label);
					e.prop('class','option');
					e.attr('name', row.name);
					e.click(function(){app.objectSelect.call(this);});
					content.append(e);
					objectMap[row.name] = {name: row.name, label: row.label, sobjecturl: row.urls.sobject, describe: row.urls.describe};
                });
            },
            error: function (err) {
                app.showNotification('ERROR:', 'Failed to load objects');
                console.log(err);
            }
        });
	}

	// TODO: deal with single and multi select scenarios
	app.optionClick = function () {
	    var content = $('#content-main');
	    if ($(this).hasClass('active')) {
	        $(this).removeClass('active');
	        if ($(this).hasClass('relationship')){
	            content.css('margin-left',"");
	            content.css('margin-right',"");
	        }
	    } else {
	        $(this).addClass('active');
	        if ($(this).hasClass('relationship')){
	            content.css('margin-left',"-90%");
	            content.css('margin-right',"90%");
	        }
	    }
	    var e = $('#next_button');
	    // find out if there are any active and set button appropriately
	    if ($('.option.active').length > 0)
	        e.prop('disabled', false);
	    else
	        e.prop('disabled', true);
		// Start or restart idle timer
		app.resetSortTimer();
    }

	// Only resort divs after idle time so we don't mess up fast clicking
    var idleSortTimer;
    app.resetSortTimer = function(){
        clearTimeout(idleSortTimer);
        idleSortTimer = setTimeout(app.sortOptionDivs,sortWaitTime);
	}

	// Keep selected divs at the top so they can be reviewed easier
    app.sortOptionDivs = function(){
        var options = $('.option');
        var content = $('#content-main');

		options.detach().sort(function (a, b) {
          var x = $(a);
          var y = $(b);
		  // Do they both have the same active state? If so then decide based on text value
          if(x.hasClass('active') === y.hasClass('active')){
              return (x.text() < y.text()) ? -1 : (x.text() > y.text()) ? 1 : 0;
          } else {
              if(x.hasClass('active'))
                  return -1
              else
                  return 1
          }
          return 0;
		});
        content.append(options);
    }

	// TODO: deal with single and multi select scenarios
	app.objectSelect = function () {
        $(this).addClass('active');
		app.getSelectedObject();
	}

	app.getSelectedObject = function (){

		//$('#next_button').prop('disabled',true);
		// which item is selected
		var selectedObjects = $('.option.active');
		$('#content-header').html('Select fields');
		var content = $('#content-main');
		var content_buttons = $('#content-buttons');
		// get describe url using name map
		baseObject = $(selectedObjects[0]).attr('name');

		content.html('');

		var search = document.createElement('input');
		search.id = 'search-box';
		search.type = 'text';
		search.className = 'search-box';
		search.placeholder = 'Filter';
		content.append(search);
		$('#search-box').keyup(app.searchList);

		content_buttons.html('');

		//execute the REST query against Salesforce
        $.ajax({
            url: myToken.instance_url + objectMap[baseObject].describe,
            headers: {
                "Authorization": "Bearer " + myToken.access_token,
                "accept": "application/json;odata=verbose"
            },
            success: function (data) {
				//console.log(data);
                //loop through the returned records and append to the officeTable
				console.log(data);
				data.fields = app.sortByKey(data.fields, "label");
                $(data.fields).each(function(row_index, row) {
					var e = document.createElement('div');
					e = $(e);
					e.text(row.label);
					e.prop('class','option');
					if(row.relationshipName !== null){
						console.log(row);
						//e.addClass('relationship');
						$(row.referenceTo).each(function(index){
							if( describeCacheStatus[this] === undefined ){
								describeCacheStatus[this] = 'ADDED';
							}
						});

					}
					e.attr('name', row.name);
					e.click(function(){app.optionClick.call(this);});
					content.append(e);
                });
				console.log(describeCacheStatus);
				app.populateDescribeCache();
				var b = document.createElement('button');
				b = $(b);
				b.text("Next");
				b.prop('id', 'next_button');
				b.prop('disabled', true);
				b.click(function(){app.getSelectedFields();});

				var buttonContent = $('#content-buttons');
				buttonContent.append(b);
            },
            error: function (err) {
                app.showNotification('ERROR:', 'Opportunities failed to load');
            }
		});


		// parse fields into query

		// add next button to get where clause
	}

	app.getSelectedFields = function(){
		$('#next_button').prop('disabled',true);
		var selectedFieldsElems = $('.option.active');
		selectedFieldsElems.each(function(index){
			selectedFields.push($(this).attr('name'));
		});

		////////////////////////////
		 //build select fields
        select_fields = '';
        headers = [];
        $(selectedFields).each(function(field_index, field) {
            if (field_index > 0)
                select_fields += ', ';
            select_fields += field;
            headers.push(field);
        });
		app.setupLimiting();
	}

	app.setupLimiting = function (){
		$('#next_button').prop('disabled',true);
		$('#content-header').html('Limit Selection');
		var content = $('#content-main');

		content.html('');
		var div = document.createElement('div');
		div = $(div);
		div.className = 'groupdiv';

		var limit_label = document.createElement('label');
		limit_label.htmlFor  = 'limit_input';
		limit_label.textContent = 'Limit';
		div.append(limit_label);

		var limit_input = document.createElement('input');
		limit_input.id = 'limit_input';
		limit_input.type = 'number';
		limit_input.step = limitStep;
		limit_input.value = 1000;
		limit_input.min = 1;
		div.append(limit_input);
		content.append(div);


		div = document.createElement('div');
		div = $(div);
		div.className = 'groupdiv';

		var order_label = document.createElement('label');
		order_label.htmlFor  = 'order_input';
		order_label.textContent = 'order by';
		div.append(order_label);

		var order_input = document.createElement('input');
		order_input.id = 'order_input';
		order_input.placeholder = 'ID, Name, ...'
		order_input.type = 'text';
		div.append(order_input);
		content.append(div);

		div = document.createElement('div');
		div = $(div);
		div.className = 'groupdiv';

		var where_label = document.createElement('label');
		where_label.htmlFor  = 'order_input';
		where_label.textContent = 'where';
		div.append(where_label);

		var where_input = document.createElement('input');
		where_input.id = 'where_input';
		where_input.placeholder = "Name like '%robot%'";
		where_input.type = 'text';
		div.append(where_input);
		content.append(div);


		var b = document.createElement('button');
		b = $(b);
		b.text("Next");
		b.prop('id', 'next_button');
		b.prop('disabled', true);
		b.click(function(){app.getLimitingData();});

		var buttonContent = $('#content-buttons');
		buttonContent.html('');
		buttonContent.append(b);

		b.prop('disabled',false);

	}

	app.getLimitingData = function(){
		var limit_to = $('#limit_input').val();
		console.log("limit:"+limit_to);
		var order_by = $('#order_input').val();
		console.log('order_by:'+order_by);
		var where_clause = $('#where_input').val();
		console.log('where_clause:'+where_clause);

		$('#next_button').prop('disabled',true);
		app.processRequest(limit_to, order_by, where_clause);
	}


	app.processRequest = function(limit_to, order_by, where_clause) {
		//build the query
        var query = 'select {0} from {1}'.replace('{0}', select_fields).replace('{1}', baseObject);
		// TODO: Clean possible WHERE in leading, could cause bugs
		if(where_clause !== ''){
			query = query + " WHERE " + where_clause;
		}
		// TODO: Clean leading ORDER BY, could cause bugs
		if(order_by !== ''){
			query = query + " ORDER BY " + order_by;
		}
		if(limit_to > 0){
			query = query + " LIMIT " + limit_to;
		}
		console.log("Query:"+query);

        //initialize the Office Table
        officeTable = new Office.TableData();
        officeTable.headers = headers;

		// TODO: consider clearing the range
		// set A1 to query string
		Office.context.document.goToByIdAsync("Sheet1!A"+currentRow, Office.GoToType.NamedItem, function (asyncResult) {

			currentRow++;
			Office.context.document.setSelectedDataAsync(
			  query, // Slice of max data per iteration
			  {coercionType: Office.CoercionType.Text},
			  function (asyncResult) {
			    if (asyncResult.status == "failed") {
					app.showNotification("ERROR","Action failed with error: " + asyncResult.error.message);
			    } else {
  					// set A2 to column headers
  					Office.context.document.goToByIdAsync("Sheet1!A"+currentRow, Office.GoToType.NamedItem, function (asyncResult) {
  					currentRow++;
  					Office.context.document.setSelectedDataAsync(
  					  officeTable.headers, // Slice of max data per iteration
  					  {coercionType: Office.CoercionType.Matrix},
  					  function (asyncResult) {
  					    if (asyncResult.status == "failed") {
  							app.showNotification("ERROR","Action failed with error: " + asyncResult.error.message);
  					    } else {
  							// get data from salesforce in A3+
  							app.getSalesforceRecords("/services/data/v"+ version + "/query/?q=" + encodeURIComponent(query));
  							console.log('log:'+query);
  					    }
  					  });
  					});
			    }
			  });
        });
	}

	app.getSalesforceRecords = function(url){

        //execute the REST query against Salesforce
        console.log("MyToken:"+myToken);
        $.ajax({
            url: myToken.instance_url + url,
            headers: {
                "Authorization": "Bearer " + myToken.access_token,
                "accept": "application/json;odata=verbose"
            },
            success: function (data) {
                //loop through the returned records and append to the officeTable
                //console.log(data);
                $(data.records).each(function(row_index, row) {
                    var data = new Array();
                    $(selectedFields).each(function(field_index, field) {
                            data.push(row[field]);
                    });
                    officeTable.rows.push(data);
                });
        				//TODO: Move cursor around and print data
        				console.log(officeTable.rows.length);
        				if(data.done === false && data.nextRecordsUrl !== undefined){
        					app.getSalesforceRecords(data.nextRecordsUrl);
        				} else {
        	               app.setData(officeTable.rows,currentRow)
        				}
            },
            error: function (err) {
                app.showNotification('ERROR:', 'Opportunities failed to load');
            }
        });

	}

	app.loginToSalesforce = function(url){
		loginurl = url;
		var content = $('#content-main');
		//TODO: clear content-main
		content.html('');
		content.html('Logging in...');
		var oauthRedirect = loginurl + "/services/oauth2/authorize?response_type=code&immediate=false&client_id=" + cid + "&redirect_uri=" + encodeURIComponent(proxy_address) + "/auth_callback&state=";
        oauthRedirect += encodeURIComponent(signalId);
        window.open(oauthRedirect, "_blank", "width=500, height=600, scrollbars=0, toolbar=0, menubar=0, resizable=0, status=0, titlebar=0");
        app.getOauthResult();
	}

  app.getOauthResult = function(){

    var url = proxy_address + "/complete_auth?token=" + encodeURIComponent(signalId);
    $.ajax( url, {cache: false, success: function(data, status, res){
      if(data == "") {
        setTimeout(app.getOauthResult,3000);
      } else {
        $.ajaxSetup({
           beforeSend: function (jqXHR, settings) {
               if (settings.url.indexOf("salesforce.com") !== -1) {
                   //take the original REST call into SalesForce and send it through our proxy
                   settings.url = proxy_address + "/api/query?q=" + encodeURIComponent(settings.url);
               }
           }
        });
        myToken = JSON.parse(data);

        app.listItems(myToken);
      }
    }});

  }

	app.setData = function(data, startCell){
		// Loop to move the cursor around and add additional data to the worksheet
		console.log("Remaining:"+data.length);
		var width = data[0].length;
		var allowedRecords = Math.floor(celldatalimit/width);
		console.log("Output Batch Size:"+allowedRecords);
		Office.context.document.goToByIdAsync("Sheet1!A"+startCell, Office.GoToType.NamedItem, function (asyncResult) {
			// Set myMatrix in the document.
			Office.context.document.setSelectedDataAsync(
			  data.slice(0,allowedRecords), // Slice of max data per iteration
			  {coercionType: Office.CoercionType.Matrix},
			  function (asyncResult) {
			    if (asyncResult.status == "failed") {
					app.showNotification("ERROR","Action failed with error: " + asyncResult.error.message);
			    } else {
					// Do we still have more data to write?
					if(data.length > allowedRecords)
						app.setData(data.slice(allowedRecords), startCell+allowedRecords);
					else
						app.showNotification("SUCCESS","Wrote records to page");
			    }
			  }
			);
        });
	}

	var conn;

	app.buildForceStuff = function (oauthCompleteCallback) {
        var callback = oauthCompleteCallback;
        var hub = null, proxy = null;

		// Open websocket to localhost
		// on Key message, open connection to Salesforce oauth
		// on oAuthComplete message finish setup

    $.ajax(proxy_address+"/token", {success: function(data, status, res){
      console.log("Success:"+data);
      signalId = data;
      app.setupLogin();
    }});
// 		if (window["WebSocket"]) {
// 	        conn = new WebSocket("ws://localhost/ws");
// 	        conn.onmessage = function(evt) {
// 				console.log(evt.data);
// 				if (evt.data.type == 'oAuthReady'){
// 					signalId = evt.data.token;
// 					app.setupLogin();
// 				} else if (evt.data.type == 'oAuthComplete') {
// 			// For the time being, use CORS until I want to build the query proxy
//
// //					function (token) {
// //                    $.ajaxSetup({
// //                        beforeSend: function (jqXHR, settings) {
// //                            if (settings.url.indexOf("salesforce.com") !== -1) {
// //                                //take the original REST call into SalesForce and send it through our proxy
// //                                settings.url = proxy_address + "/api/query?q=" + settings.url;
// //                            }
// //                        }
// //                    });
// //                    //send the token back on the provided callback
//                     callback(evt.data.token);
// 				}
// 	            // appendLog($("<div/>").text(evt.data))
// 	        }
// 	    } else {
// 	        // TODO: Fallback code if web socket isn't available
// 	        //appendLog($("<div><b>Your browser does not support WebSockets.</b></div>"))
// 			console.log("unable to open websocket, not supported");
// 	    }


//        //import signalR scripts from proxy
//        $.getScript(proxy_address + "/scripts/jquery.signalR-2.1.2.min.js").done(function () {
//            $.getScript(proxy_address + "/signalr/hubs").done(function () {
//                //setup signalR hub through proxy
//                $.connection.hub = $.hubConnection(proxy_address + "/signalr/hubs", { useDefaultPath: false });
//                hub = $.connection.hub;
//                proxy = $.connection.hub.createHubProxy("OAuthHub");
//
//                //establish a callback for the server to send tokens from
//                proxy.on("oAuthComplete", function (token) {
//                    $.ajaxSetup({
//                        beforeSend: function (jqXHR, settings) {
//                            if (settings.url.indexOf("salesforce.com") !== -1) {
//                                //take the original REST call into SalesForce and send it through our proxy
//                                settings.url = proxy_address + "/api/query?q=" + settings.url;
//                            }
//                        }
//                    });
//                    //send the token back on the provided callback
//                    callback(token);
//                });
//
//                // Start the connection to the hub
//                $.connection.hub.start({ jsonp: true }).done(function () {
//                    //initialize the hub and then get the client off of it
//                    proxy.invoke("initialize");
//                    signalId = $.connection.hub.id;
//                }).fail(function (err) {
//                    callback(null);
//                });
//            });
//        });
	}

	app.sortByKey = function(array, key) {
	    return array.sort(function(a, b) {
	        var x = a[key]; var y = b[key];
	        return ((x < y) ? -1 : ((x > y) ? 1 : 0));
	    });
	}

	app.populateDescribeCache = function(){
		console.log(describeCacheStatus);
		$.each(describeCacheStatus,function(name, obj){
			describeCacheStatus[name] = 'REQUESTED';
			app.getDescribeData(name);
		});
	}

	app.getDescribeData = function(name){
		$.ajax({
        url: myToken.instance_url + objectMap[name].describe,
        headers: {
            "Authorization": "Bearer " + myToken.access_token,
            "accept": "application/json;odata=verbose"
        },
        success: function (data) {
  				//console.log(data);
  				objectMap[name].describedata = data;
                  describeCacheStatus[name] = 'COMPLETE';
  				console.log(objectMap);
  				keepMeFields = objectMap;
        },
        error: function (err) {
            describeCacheStatus[name] = 'ERROR';
        }
		});
	}
  return app;
})();
