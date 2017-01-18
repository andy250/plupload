/**
 * Queue.js
 *
 * Copyright 2015, Moxiecode Systems AB
 * Released under GPL License.
 *
 * License: http://www.plupload.com/license
 * Contributing: http://www.plupload.com/contributing
 */


/**
@contsructor
@class plupload.core.Queue
@private
*/
define('plupload/core/Queue', [
    'moxie/core/utils/Basic',
    'plupload/core/Collection',
    'plupload/core/Optionable',
    'plupload/core/Queueable',
    'plupload/core/Stats'
], function (Basic, Collection, Optionable, Queueable, Stats) {

    var dispatches = [
        /**
         * Dispatched as soon as activity starts
         *
         * @event started
         * @param {Object} event
         */
        'Started',

        'StateChanged',


        /**
         * Dispatched as the activity progresses
         *
         * @event
         * @param {Object} event
         *      @param {Number} event.percent
         *      @param {Number} event.processed
         *      @param {Number} event.total
         */
        'Progress',


        /**
         *
         */
        'Paused',


        'Done',

        'Stopped'
    ];

    /**
     * @class Queue
     * @constructor
     * @extends EventTarget
     */
    return (function (Parent) {
        Basic.inherit(Queue, Parent);


        function Queue(options) {
            Parent.apply(this, arguments);

            /**
            @property _queue
            @type {Collection}
            @private
            */
            this._queue = new Collection();

            /**
             * @property state
             * @type {Number}
             * @default Queue.IDLE
             * @readOnly
             */
            this.state = Queue.IDLE;


            /**
            @property stats
            @type {Stats}
            @readOnly
            */
            this.stats = new Stats();


            this._connected = true;


            this._wait = 10000,


            this._reconnectAttempts = 0,


            this._waitHandle = null,


            this._options = Basic.extend({
                max_slots: 1,
                max_retries: 0,
                auto_start: false,
                finish_active: false,
                pause_before_start: true
            }, options);
        }


        Queue.IDLE = 0;
        Queue.STOPPED = 1;
        Queue.STARTED = 2;
        Queue.PAUSED = 3;
        Queue.DESTROYED = 8;


        Basic.extend(Queue.prototype, {

            /**
             * Returns number of items in the queue
             *
             * @method count
             * @returns {Number}
             */
            count: function () {
                return this._queue.count();
            },

            /**
             * Start the queue
             *
             * @method start
             */
            start: function () {
                var self = this;
                var prevState = self.state;

                if (self.state === Queue.STARTED) {
                    return false;
                }

                self.state = Queue.STARTED;
                self.trigger('StateChanged', self.state, prevState);

                self._wait = 10000;
                self._reconnectAttempts = 0;
                self._startTime = new Date();

                processNext.call(self);
                return true;
            },


            pause: function () {
                var self = this;
                var prevState = self.state;

                if (self.state === Queue.PAUSED) {
                    return false;
                }

                this._queue.each(function (item) {
                    if (Basic.inArray(item.state, [Queueable.PROCESSING, Queueable.RESUMED]) !== -1) {
                        self.pauseItem(item.uid);
                    }
                });

                self.state = Queue.PAUSED;
                this.trigger('StateChanged', self.state, prevState);
                self.trigger('Paused');

                return true;
            },

            resume: function () {
                var self = this;
                var prevState = self.state;

                if (self.state === Queue.STARTED) {
                    return false;
                }

                this._queue.each(function (item) {
                    if (Basic.inArray(item.state, [Queueable.PAUSED, Queueable.IDLE]) !== -1) {
                        self.markForResume(item.uid);
                    }
                });

                self.state = Queue.STARTED;
                self.trigger('StateChanged', self.state, prevState);

                processNext.call(self);

                return true;
            },

            continueProcessing: function () {
                var self = this;
                if (self.state === Queue.STARTED) {
                    self._queue.each(function (item) {
                        if (item.state === Queueable.PROCESSING) {
                            item.continueProcessing();
                        }
                    });
                    calcStats.call(self);
                    processNext.call(self);
                }
            },

            /**
             * Stop the queue. If `finish_active=true` the queue will wait until active items are done, before
             * stopping.
             *
             * @method stop
             */
            stop: function () {
                var self = this;
                var prevState = self.state;

                if (self.getOption('finish_active')) {
                    return;
                } else if (self.stats.processing || self.stats.paused) {
                    self._queue.each(function (item) {
                        self.stopItem(item.uid);
                    });
                }

                self.state = Queue.STOPPED;
                self.trigger('StateChanged', self.state, prevState);
                self.trigger('Stopped');
            },


            forEachItem: function (cb) {
                this._queue.each(cb);
            },

            getItem: function (uid) {
                return this._queue.get(uid);
            },


            /**
             * Add instance of Queueable to the queue. If `auto_start=true` queue will start as well.
             *
             * @method addItem
             * @param {Queueable} item
             */
            addItem: function (item) {
                var self = this;

                var max_retries = self.getOption('max_retries');
                if (max_retries) {
                    item.retryReset();
                }

                item.bind('Progress', function (e) {
                    calcStats.call(self);
                    if (!self._connected && e.delta > 0) {
                        reconnect.call(self);
                    }
                });

                item.bind('Failed', function (e, result) {
                    if (max_retries && this.retries < max_retries) {
                        // stop resets state of this instance to IDLE so it can be picked up from the queue again
                        this.stop();
                        this.retry();
                    } else {
                        // all retries failed or max_retries not set
                        this.abort(result);
                    }
                });

                item.bind('serverdisconnected', function () {
                    disconnect.call(self);
                });

                item.bind('Processed', function () {
                    calcStats.call(self);
                    processNext.call(self);
                }, 0, this);

                self._queue.add(item.uid, item);
                calcStats.call(self);
                item.trigger('Queued');

                if (self.getOption('auto_start') && self.state !== Queue.PAUSED) {
                    var started = self.start();
                    if (!started) {
                        processNext.call(self);
                    }
                }
            },


            /**
             * Extracts item from the queue by its uid and returns it.
             *
             * @method extractItem
             * @param {String} uid
             * @return {Queueable} Item that was removed
             */
            extractItem: function (uid) {
                var item = this._queue.get(uid);

                if (item) {
                    this.stopItem(item.uid);

                    this._queue.remove(uid);
                    calcStats.call(this);

                    if (this.state === Queue.STARTED) {
                        processNext.call(this);
                    }
                }
                return item;
            },

            /**
             * Removes item from the queue and destroys it
             *
             * @method removeItem
             * @param {String} uid
             */
            removeItem: function (uid) {
                var item = this.extractItem(uid);
                if (item) {
                    item.destroy();
                }
            },


            stopItem: function (uid) {
                var item = this._queue.get(uid);
                if (item && item.state !== Queueable.IDLE) {
                    if (item.state === Queueable.PROCESSING) {
                        this.stats.processing--;
                    }
                    item.stop();
                } else {
                    return false;
                }

                return true;
            },


            pauseItem: function (uid) {
                var item = this._queue.get(uid);
                if (item && item.state !== Queueable.PAUSED) {
                    if (item.state === Queueable.PROCESSING) {
                        this.stats.processing--;
                    }
                    this.stats.paused++;
                    item.pause();
                } else {
                    return false;
                }

                return true;
            },


            markForResume: function (uid) {
                var item = this._queue.get(uid);
                if (item && item.state === Queueable.PAUSED) {
                    item.state = Queueable.RESUMED;
                    this.stats.paused--;
                } else {
                    return false;
                }

                return true;
            },


            countSpareSlots: function () {
                return Math.max(this.getOption('max_slots') - this.stats.processing, 0);
            },


            toArray: function () {
                var arr = [];
                this.forEachItem(function (item) {
                    arr.push(item);
                });
                return arr;
            },


            clear: function () {
                var self = this;

                if (self.state !== Queue.STOPPED) {
                    // stop the active queue first
                    self.bindOnce('Stopped', function () {
                        self.clear();
                    });
                    return self.stop();
                } else {
                    self._queue.clear();
                    self.stats.reset();
                }
            },


            destroy: function () {
                var self = this;
                var prevState = self.state;

                if (self.state === Queue.DESTROYED) {
                    return; // already destroyed
                }

                if (self.state !== Queue.STOPPED) {
                    // stop the active queue first
                    self.bindOnce('Stopped', function () {
                        self.destroy();
                    });
                    return self.stop();
                } else {
                    self.trigger('Destroy');

                    self.clear();

                    self.state = Queue.DESTROYED;
                    self.trigger('StateChanged', self.state, prevState);

                    self.unbindAll();
                    self._queue = self.stats = self._startTime = null;
                }
            }
        });

        function disconnect() {
            this._connected = false;
            if (!this._reconnectHandle) {
                this.trigger('ServerDisconnected');
                scheduleResume.call(this);
            }
        }


        function reconnect() {
            this._connected = true;
            this._wait = 10000;
            this._reconnectAttempts = 0;
            if (this._reconnectHandle) {
                window.clearTimeout(this._reconnectHandle);
                this._reconnectHandle = null;
            }
            this.trigger('ServerReconnected');
        }


        function scheduleResume() {
            var self = this;
            self._reconnectAttempts++;
            if (self._reconnectAttempts > 1440) { // don't retry longer than ~24h
                self.trigger('TooManyReconnects');
            } else {
                self._reconnectHandle = setTimeout(function () {
                    window.clearTimeout(self._reconnectHandle);
                    self._reconnectHandle = null;
                    self.resume();
                }, self._wait);
                self._wait = Math.min(self._wait * 2, 60 * 1000); // no longer than 1 minute
            }
        }


        function getCandidate() {
            var nextItem;
            this._queue.each(function (item) {
                if (item.state === Queueable.IDLE || item.state === Queueable.RESUMED) {
                    nextItem = item;
                    return false;
                }
            });
            return nextItem;
        }


        function processNext() {
            var self = this;
            var item;

            if (self.state !== Queue.PAUSED && self.state !== Queue.STOPPED) {
                if (self.stats.processing < self.getOption('max_slots')) {
                    item = getCandidate.call(self);
                    if (item) {
                        self.stats.processing++;
                        if (item.state === Queueable.IDLE) {
                            item.start(self.getOptions());
                        } else {
                            item.resume();
                        }
                    } else { // we ran out of pending and active items too, so we are done
                        calcStats.call(self);

                        if (!self.stats.processing) {
                            self.stop();
                            return self.trigger('Done');
                        }
                    }

                    Basic.delay.call(self, processNext);
                }
            }
        }


        function calcStats() {
            var self = this;
            self.stats.reset();

            self.forEachItem(function (item) {
                self.stats.processed += item.processed;
                self.stats.total += item.total;
                self.stats.failedBytes += item.failedBytes;

                switch (item.state) {
                    case Queueable.DONE:
                        self.stats.done++;
                        self.stats.uploaded = self.stats.done; // for backward compatibility
                        break;

                    case Queueable.FAILED:
                        self.stats.failed++;
                        break;

                    case Queueable.PROCESSING:
                        self.stats.processing++;
                        break;

                    default:
                        self.stats.queued++;
                }

                if (self._startTime) {
                    self.stats.processedPerSec = Math.ceil(self.stats.processed / ((+new Date() - self._startTime || 1) / 1000.0));
                    self.stats.bytesPerSec = self.stats.processedPerSec; // for backward compatibility
                }

                if (self.stats.total) {
                    self.stats.percent = Math.ceil(self.stats.processed / self.stats.total * 100);
                }
            });

            // for backward compatibility
            self.stats.loaded = self.stats.processed;
            self.stats.size = self.stats.total;
        }

        return Queue;

    } (Optionable));
});