/**
 * 'api/events': Events history API
 */

var express = require('express');

var runtime;
var secureFnc;
var checkGroupsFnc;

module.exports = {
    init: function (_runtime, _secureFnc, _checkGroupsFnc) {
        runtime = _runtime;
        secureFnc = _secureFnc;
        checkGroupsFnc = _checkGroupsFnc;
    },
    app: function () {
        var eventsApp = express();
        eventsApp.use(function (req, res, next) {
            if (!runtime.project) {
                res.status(404).end();
            } else {
                next();
            }
        });

        /**
         * GET Events
         * Return events history
         */
        eventsApp.get("/api/events", secureFnc, function (req, res, next) {
            var from = req.query.start ? parseInt(req.query.start) : 0;
            var to = req.query.end ? parseInt(req.query.end) : Number.MAX_SAFE_INTEGER;
            var filter = req.query.filter || '';
            var userFilter = req.query.userFilter || '';
            runtime.eventsMgr.getEvents(from, to, filter, userFilter).then(result => {
                res.json(result);
            }).catch(function (err) {
                runtime.logger.error('api.get-events: ' + err);
                res.status(400).json({ error: 'failed-to-get-events', message: err.toString() });
            });
        });

        /**
         * POST Log event from client
         */
        eventsApp.post("/api/events/log", secureFnc, function (req, res, next) {
            if (runtime.eventsMgr) {
                runtime.eventsMgr.logEvent(
                    req.body.type || 'client-event',
                    req.body.category || 'user',
                    req.body.user || '',
                    req.body.message || '',
                    req.body.details || {}
                ).then(() => {
                    res.status(204).end();
                }).catch(function (err) {
                    runtime.logger.error('api.log-event: ' + err);
                    res.status(400).json({ error: 'failed-to-log-event', message: err.toString() });
                });
            } else {
                res.status(503).end();
            }
        });

        /**
         * POST Clear events history
         */
        eventsApp.post("/api/events/clear", secureFnc, function (req, res, next) {
            var permission = checkGroupsFnc(req);
            if (runtime.authJwt && !runtime.authJwt.haveAdminPermission(permission)) {
                res.status(401).send();
            } else {
                var dtlimit = new Date(req.body.dtlimit);
                runtime.eventsMgr.clearHistory(dtlimit).then(() => {
                    res.status(200).end();
                }).catch(function (err) {
                    runtime.logger.error('api.clear-events: ' + err);
                    res.status(400).json({ error: 'failed-to-clear-events', message: err.toString() });
                });
            }
        });

        return eventsApp;
    }
};
