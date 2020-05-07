/**
 * Queueable.js
 *
 * Copyright 2015, Moxiecode Systems AB
 * Released under GPL License.
 *
 * License: http://www.plupload.com/license
 * Contributing: http://www.plupload.com/contributing
 */


/**
Every queue item must have properties, implement methods and fire events defined in this class

@contsructor
@class plupload.core.Queueable
@private
@decorator
@extends EventTarget
*/
define('plupload/core/Queueable', [
    'moxie/core/utils/Basic',
    'plupload/core/Optionable'
], function(Basic, Optionable) {

    var dispatches = [
        /**
         * Dispatched when the item is put on pending list
         *
         * @event queued
         * @param {Object} event
         */
        'queued',


        /**
         * Dispatched as soon as activity starts
         *
         * @event started
         * @param {Object} event
         */
        'started',


        'paused',


        'stopped',


        /**
         * Dispatched as the activity progresses
         *
         * @event
         * @param {Object} event
         *      @param {Number} event.percent
         *      @param {Number} [event.processed]
         *      @param {Number} [event.total]
         */
        'progress',

        /**
         * Dispatched each time the queueable fails upon a single retry.
         */
        'failed',

        /**
         * Dispatched when the queueable fails despite all retries.
         */
        'aborted',

        /**
         * Dispatched when the queueable is processed with a success.
         */
        'done',

        /**
         * Dispatched after a single retry (after done, failed and aborted) so it can be retried or other items can be processed.
         */
        'processed',

        /**
         * Dispatched when the queueable is ultimately processed and can be cleaned up.
         */
        'completed'
    ];


    return (function(Parent) {
        Basic.inherit(Queueable, Parent);


        function Queueable() {
            Parent.apply(this, arguments);
        }


        Queueable.IDLE = 0;
        Queueable.PROCESSING = 1;
        Queueable.PAUSED = 2;
        Queueable.RESUMED = 3;
        Queueable.DONE = 4;
        Queueable.FAILED = 5;
        Queueable.DESTROYED = 8;


        Basic.extend(Queueable.prototype, {

            uid: Basic.guid(),

            state: Queueable.IDLE,

            processed: 0,

            total: 0,

            percent: 0,

            failedBytes: 0,

            retries: 0,

            canRetry: false,

            progressTimestamp: null,

            start: function() {
                this.state = Queueable.PROCESSING;
                this.progressTimestamp = new Date().getTime();
                this.trigger('started');
            },


            pause: function() {
                this.progressTimestamp = null;
                this.processed = this.percent = 0; // by default reset all progress
                this.loaded = this.processed; // for backward compatibility

                this.state = Queueable.PAUSED;
                this.trigger('paused');
            },

            
            resume: function () {
                this.state = Queueable.PROCESSING;
                this.progressTimestamp = new Date().getTime();
                this.trigger('resumed');
            },


            stop: function() {
                this.progressTimestamp = null;
                this.processed = this.percent = 0;
                this.loaded = this.processed; // for backward compatibility

                this.state = Queueable.IDLE;
                this.trigger('stopped');
            },


            continueProcessing: function () {
                this.trigger('continued');
            },


            done: function(result) {
                this.processed = this.total;
                this.loaded = this.processed; // for backward compatibility
                this.percent = 100;
                this.failedBytes = 0;

                this.state = Queueable.DONE;
                this.trigger('done', result);
                this.trigger('processed');
                this.trigger('completed');
            },


            failed: function(result) {
                this.progressTimestamp = null;
                this.processed = this.percent = 0; // reset the progress
                this.loaded = this.processed; // for backward compatibility
                this.failedBytes = this.total;

                this.state = Queueable.FAILED;
                this.trigger('failed', result);
                this.trigger('processed', result);

                if (!this.canRetry) {
                    this.trigger('completed');
                }
            },


            abort: function (result) {
                this.processed = this.percent = 0;
                this.loaded = this.processed; // for backward compatibility
                this.failedBytes = this.total;

                this.canRetry = false;
                this.state = Queueable.FAILED;
                this.trigger('aborted', result);
            },


            completed: function () {
                this.trigger('completed');
            },


            progress: function(processed, total) {
                if (total) {
                    this.total = total;
                }

                var previouslyProcessed = this.processed; 
                this.progressTimestamp = new Date().getTime();
                this.processed = Math.min(Math.max(previouslyProcessed, processed), this.total);
                this.loaded = this.processed; // for backward compatibility
                this.percent = Math.ceil(this.processed / this.total * 100);

                this.trigger({
                    type: 'progress',
                    delta: this.processed - previouslyProcessed,
                    failedBytes: this.failedBytes,
                    loaded: this.processed,
                    total: this.total
                });
            },


            destroy: function() {
                if (this.state === Queueable.DESTROYED) {
                    return; // already destroyed
                }

                this.state = Queueable.DESTROYED;
                this.trigger('destroy');
                this.unbindAll();
            },

            retry: function () {
                this.retries++;
            },

            retryReset: function () {
                this.retries = 0;
                this.canRetry = true;
            }

        });

        return Queueable;

    }(Optionable));
});