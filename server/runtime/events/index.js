/**
 * Events manager: log and retrieve user/system/script events
 */

'use strict';

const eventstorage = require('./eventstorage');

function EventsManager(_runtime) {
    var runtime = _runtime;
    var logger = runtime.logger;

    /**
     * Init the events manager
     */
    this.start = function () {
        return eventstorage.init(runtime.settings, logger);
    }

    /**
     * Stop the events manager
     */
    this.stop = function () {
        return new Promise(function (resolve, reject) {
            eventstorage.close();
            resolve();
        });
    }

    /**
     * Log an event
     * @param {*} type 
     * @param {*} category 
     * @param {*} user 
     * @param {*} message 
     * @param {*} details 
     */
    this.logEvent = function (type, category, user, message, details) {
        return eventstorage.addEvent({
            timestamp: Date.now(),
            type: type,
            category: category || '',
            user: user || '',
            message: message || '',
            details: details || {}
        }).catch(function (err) {
            logger.error('events.log-event.failed: ' + err);
        });
    }

    /**
     * Get events list
     * @param {*} from 
     * @param {*} to 
     * @param {*} filter 
     */
    this.getEvents = function (from, to, filter, userFilter) {
        return eventstorage.getEvents(from, to, filter, userFilter);
    }

    /**
     * Clear events history
     * @param {*} dtlimit 
     */
    this.clearHistory = function (dtlimit) {
        return eventstorage.clearEventsHistory(dtlimit);
    }
}

module.exports = {
    create: function (runtime) {
        return new EventsManager(runtime);
    }
};
