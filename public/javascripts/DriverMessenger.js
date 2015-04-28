var sys     = require('sys');
var pg      = require('pg');
var stages  = require('./stages');
var strings = require('./strings');
var parser  = require('./messageParser');
var db      = require('./db');

var RiderMessenger = require('./RiderMessenger');

/* Twilio Credentials */
var accountSid    = 'ACf55ee981f914dc797efa85947d9f60b8';
var authToken     = 'cc3c8f0a7949ce40356c029579934c0f';
var twilio        = require('twilio');
var twilioClient  = require('twilio')(accountSid, authToken);
var TWILIO_NUMBER = '+18443359847';

function driverStartShift(res, from) {
    pg.connect(process.env.DATABASE_URL, function(err, client) {
        if (!err) {
            sys.log("driverStartShift: connected to DB");
            var query = client.query("SELECT num FROM drivers WHERE num = '" + from + "' AND working = true", function(err, result) {
                var responseText = "";
                if (!err) {
                    //Successful query
                    if (result.rows.length == 1) {
                        responseText += "I can't do that, you are already working.";
                        var response = new twilio.TwimlResponse();
                        response.sms(responseText);
                        res.send(response.toString(), {
                            'Content-Type':'text/xml'
                        }, 200);
                    } else {
                        var query = client.query("UPDATE drivers SET working = true WHERE num = '" + from + "'", function(err, result) {
                            if (!err) {
                                responseText += "You started your shift - good luck!";
                            } else {
                                responseText += "We're sorry, there was an error with the DB";
                            }

                            var response = new twilio.TwimlResponse();
                            response.sms(responseText);
                            res.send(response.toString(), {
                                'Content-Type':'text/xml'
                            }, 200);

                            client.end();
                            sys.log("driverStartShift.js: closed connection to DB");
                            return;
                        });
                    }
                } else {
                    responseText += "We're sorry, there was an error with the DB";
                    sys.log("driverStartShift: Error querying the DB");

                    var response = new twilio.TwimlResponse();
                    response.sms(responseText);
                    res.send(response.toString(), {
                        'Content-Type':'text/xml'
                    }, 200);
                }
            });
       } else {
            //whoops
       }
    });
}

function driverEndShift(res, from) {

}

function handleRequestResponse(res, message, from) {
    if (message.toLowerCase() == 'start shift') {
        driverStartShift(res, from);
    }

    if (message.toLowerCase() == 'end shift') {
        driverEndShift(res, from);
    }

    if (parser.isYesMessage(message)) {
        sendNumberToDriver(res, from);
        //markDriverUnavailable(from);
    } else if (parser.isNoMessage(message)) {
        // pass the request on to the next driver
    } else {
        // wasn't a response to the request, send back default message?
    }
}

function sendNumberToDriver(res, driverNum) {
    pg.connect(process.env.DATABASE_URL, function(err, client) {
        if (!err) {
            // Get rider's number
            var queryString = "SELECT giving_ride_to FROM drivers WHERE num = '" + driverNum + "'";
            var query = client.query(queryString, function(err, result) {
                if (!err) {
                    var riderNum = result.rows[0].giving_ride_to;
                    var responseText = "Here is the rider's number: " + riderNum;

                    var response = new twilio.TwimlResponse();
                    response.sms(responseText);
                    res.cookie('driveStage', stages.driveStages.AWAITING_END_RIDE);
                    res.send(response.toString(), {
                        'Content-Type':'text/xml'
                    }, 200);

                    // twilioClient.sendSms({
                    //     to: driverNum,
                    //     from: TWILIO_NUMBER,
                    //     body: responseText
                    // }, function(error, message) {
                    //     if (error) {

                    //     }
                    // });

                    // Remove rider from waiting queue if there
                    for (var i = 0; i < global.riderWaitingQueue; i++) {
                        if (global.riderWaitingQueue[i] == riderNum) {
                            global.riderWaitingQueue.splice(i, 1);
                            return;
                        }
                    }
                } else {
                    // uh oh
                }

                client.end();
                sys.log("sendNumberToDriver.js: closed connection to DB");
            });
        } else {
            // uh oh
        }
    });
}

function handleEndRideText(res, message, from) {
    if (parser.isEndRideMessage(message)) {
        pg.connect(process.env.DATABASE_URL, function(err, client) {
            if (!err) {
                // Get rider's number
                var queryString = "SELECT giving_ride_to FROM drivers WHERE num = '" + from + "'";
                var query = client.query(queryString, function(err, result) {
                    if (!err) {
                        // Text rider for feedback
                        var riderNum = result.rows[0].giving_ride_to;
                        twilioClient.sendSms({
                            to: riderNum,
                            from: TWILIO_NUMBER,
                            body: strings.feedbackQuestion
                        }, function(error, message) {
                            if (error) {
                                // uh oh
                            }
                        });

                        // Mark driver available for new ride
                        var queryString = "UPDATE drivers SET on_ride = false WHERE num = '" + from + "'";
                        var query = client.query(queryString, function(err, result) {
                            if (!err) {
                                // cool
                            } else {
                                // uh oh
                            }
                            client.end();
                        });
                    } else {
                        // uh oh
                    }
                });
            } else {
                // uh oh
            }
        });
    } else {
        // ignore for now
    }
}

module.exports = {
    handleText: function(res, message, from, driveStage) {
        switch (driveStage) {
            // TODO: what if driver randomly texts server? Can't assume it's in response
            //       to a ride request. Leave for "edge case" work spring quarter
            case stages.driveStages.NOTHING:
                sys.log("DriverMessenger.handleText: Driver stage is NOTHING");
                handleRequestResponse(res, message, from);
                break;

            case stages.driveStages.AWAITING_START_RIDE:
                sys.log("DriverMessenger.handleText: Driver stage is NOTHING");
                handleStartRideText(res, message);
                break;

            case stages.driveStages.AWAITING_END_RIDE:
                handleEndRideText(res, message, from);
                sys.log("DriverMessenger.handleText: Driver stage is NOTHING");
                break;
        }
    },
    textDriverForConfirmation: function(driverNumber, riderNumber) {
        pg.connect(process.env.DATABASE_URL, function(err, client) {
            if (!err) {
                var queryString = "UPDATE drivers SET giving_ride_to = '" + riderNumber + "' WHERE num = '" + driverNumber + "'";
                var query = client.query(queryString, function(err, result) {
                    if (!err) {

                    } else {

                    }
                });
            } else {

            }

            client.end();
            sys.log("textDriver.js: closed connection to DB");
        });

        twilioClient.sendSms({
            to: driverNumber,
            from: TWILIO_NUMBER,
            body: strings.acceptRideQuestion
        }, function(error, message) {
            if (error) {
                sys.log('textDriverForConfirmation: Failed to send message asking if driver wanted to accept ride, ' + error.message);
                // TODO: Either try resending text, or send text to next available driver? Can be part of "edge case/error handling"
                //       work to be done spring quarter.
            }
        });
    }
};
