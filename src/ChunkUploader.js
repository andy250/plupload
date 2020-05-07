/**
 * ChunkUploader.js
 *
 * Copyright 2015, Moxiecode Systems AB
 * Released under GPL License.
 *
 * License: http://www.plupload.com/license
 * Contributing: http://www.plupload.com/contributing
 */

/**
 * @class plupload.ChunkUploader
 * @extends plupload.core.Queueable
 * @constructor
 * @private
 * @final
 * @constructor
 */
define('plupload/ChunkUploader', [
    'moxie/core/utils/Basic',
    'plupload/core/Collection',
    'plupload/core/Queueable',
    'moxie/xhr/XMLHttpRequest',
    'moxie/xhr/FormData'
], function (Basic, Collection, Queueable, XMLHttpRequest, FormData) {

    function ChunkUploader(blob, options, chunkInfo) {
        var _xhr;
        var _options;
        var _blob = blob;
        var _chunkInfo = chunkInfo;
        var _progressCheck = null;
        var _timeout = 20000; // 20 seconds timeout on OPTIONS requests and 20 seconds of inactivity of a POST request (POST request can take much longer)

        Queueable.call(this);

        _chunkInfo.retries = this.retries = 0;
        this.setOptions(options);

        Basic.extend(this, {

            uid: Basic.guid(),

            start: function (options) {
                var self = this;
                var formData;

                // have the options override local to start() method only
                _options = options ? Basic.extendImmutable({}, this.getOptions(), options) : this.getOptions();

                ChunkUploader.prototype.start.call(this);

                if (_progressCheck) {
                    clearInterval(_progressCheck);
                }

                self.getChunkUploadUrl(function (url) {

                    _chunkInfo.url = url;

                    if (_blob.size === 0) {
                        return self.failed({
                            req: url,
                            response: 'File is gone: ' + _chunkInfo.filename,
                            status: 410     // file is "gone" - probably removed or renamed - will retry couple of times and fail the whole file eventually
                        });
                    }

                    _xhr = new XMLHttpRequest();

                    if (_options.chunk_size && _options.assumed_upload_speed) {
                        _xhr.timeout = Math.floor(1000 * (_options.chunk_size / _options.assumed_upload_speed)); // round to milliseconds
                    }

                    if (_xhr.upload) {
                        _xhr.upload.onprogress = function (e) {
                            self.progress(e.loaded, e.total);
                        };

                        _progressCheck = setInterval(function () {
                            var stamp = self.progressTimestamp;
                            if (self.state !== Queueable.PAUSED && stamp != null) {
                                var now = new Date().getTime();
                                if (stamp != null && (stamp + _timeout < now)) {
                                    clearInterval(_progressCheck);
                                    self.stop();
                                    self.failed({
                                        req: url,
                                        response: 'Progress check freeze: ' + (now - stamp).toString(),
                                        status: 503     // service unavailable - will cause "server disconnected"
                                    });
                                }
                            }
                        }, 1000);
                    }

                    _xhr.onload = function () {
                        clearInterval(_progressCheck);

                        var result = {
                            req: url,
                            response: this.responseText,
                            status: this.status,
                            responseHeaders: this.getAllResponseHeaders()
                        };

                        if (this.status !== 200) { // assume error - anything other than 200 OK !! testing !!
                            result.preventok = true;
                            return self.failed(result);
                        }

                        if (_options.chunk_header_validate) {
                            var h = null;
                            try {
                                h = this.getResponseHeader(_options.chunk_header_validate);
                                var hv = (h || '').split(':')[1].trim();
                                var fschunk = parseInt(hv, 10);
                                if (_chunkInfo.seq !== fschunk) {
                                    result.invalidchunk = 'Expected:' + _chunkInfo.seq + '; Recevied:' + fschunk;
                                    return self.failed(result);    
                                }
                            } catch (err) {
                                result.invalidchunk = 'Could not parse ' + _options.chunk_header_validate + '=' + h;
                                return self.failed(result);
                            }
                        }

                        _chunkInfo.xhrdone = true;
                        self.done(result);
                    };

                    _xhr.onerror = function () {
                        clearInterval(_progressCheck);
                        self.failed({
                            req: url,
                            response: this.responseText,
                            errstatus: this.status,
                            status: 520      // unknown error - will cause "server disconnected"
                        });
                    };

                    _xhr.ontimeout = function () {
                        clearInterval(_progressCheck);
                        self.failed({
                            req: url,
                            status: 599      // service timeout - unofficial - will cause "server disconnected"
                        });
                    };

                    _xhr.onloadend = function () {
                        clearInterval(_progressCheck);
                        if (_xhr) {
                            _xhr.onload = _xhr.onloadend = _xhr.onerror = _xhr.ontimeout = null;
                            _xhr = null;
                        }
                    };

                    _xhr.open(_options.http_method, url, true);

                    // headers must be set after request is already opened, otherwise INVALID_STATE_ERR exception will raise
                    if (!Basic.isEmptyObj(_options.headers)) {
                        Basic.each(_options.headers, function (val, key) {
                            _xhr.setRequestHeader(key, val);
                        });
                    }

                    if (_options.multipart) {
                        formData = new FormData();

                        if (_options.multipart_append_params && !Basic.isEmptyObj(_options.params)) {
                            Basic.each(_options.params, function (val, key) {
                                formData.append(key, val);
                            });
                        }

                        formData.append(_options.file_data_name, _blob);

                        _xhr.send(formData);
                    } else { // if no multipart, send as binary stream
                        if (Basic.isEmptyObj(_options.headers) || !_options.headers['content-type']) {
                            _xhr.setRequestHeader('content-type', 'application/octet-stream'); // binary stream header
                        }

                        try {
                            if (typeof _options.server_log === 'function' && _blob.size === 0) {
                                _options.server_log('Empty blob before sending! ' + JSON.stringify(_chunkInfo) + '\n================', 'ERROR');
                            }
                        } catch (err) {
                        }

                        _xhr.send(_blob);
                        _chunkInfo.xhrsent = true;
                    }
                });
            },


            stop: function () {
                ChunkUploader.prototype.stop.call(this);
                clearInterval(_progressCheck);

                if (_xhr) {
                    _xhr.abort();
                    if (_xhr) {
                        _xhr.onload = _xhr.onloadend = _xhr.onerror = _xhr.ontimeout = null;
                        _xhr = null;
                    }
                }
            },

            retry: function () {
                ChunkUploader.prototype.retry.call(this);
                _chunkInfo.retries = this.retries;
            },

            retryReset: function () {
                ChunkUploader.prototype.retryReset.call(this);
            },

            serverDisconnected: function () {
                this.trigger('serverdisconnected');
                this.retryReset();
                this.stop();
            },

            getChunkUploadUrl: function (callback) {
                if (typeof (_options.chunk_upload_url) === 'function') {
                    _options.chunk_upload_url(_blob, _chunkInfo, callback);
                } else {
                    callback(_options.multipart ? _options.url : buildUrl(_options.url, _options.params));
                }
            },

            failed: function (result) {
                try {
                    if (typeof _options.server_log === 'function' && result.status !== 503) {
                        _options.server_log('ChunkUploader error: ' + JSON.stringify(_chunkInfo) +
                        '\nXHR result  : ' + JSON.stringify(result) +
                        '\nBlob length : ' + _blob.size +
                        '\nBlob ruid   : ' + _blob.ruid +
                        '\nBlob uid    : ' + _blob.uid +
                        '\n================', 'ERROR')
                    }
                } catch (err) {
                }

                ChunkUploader.prototype.failed.call(this, result);
            },

            continueProcessing: function () {
                this.stop();
                ChunkUploader.prototype.continueProcessing.call(this);
            },

            setBlob: function (blob) {
                _blob = blob;
            }
        });


        /**
         * Builds a full url out of a base URL and an object with items to append as query string items.
         *
         * @method buildUrl
         * @private
         * @param {String} url Base URL to append query string items to.
         * @param {Object} items Name/value object to serialize as a querystring.
         * @return {String} String with url + serialized query string items.
         */
        function buildUrl(url, items) {
            var query = '';

            Basic.each(items, function (value, name) {
                query += (query ? '&' : '') + encodeURIComponent(name) + '=' + encodeURIComponent(value);
            });

            if (query) {
                url += (url.indexOf('?') > 0 ? '&' : '?') + query;
            }

            return url;
        }

    }

    ChunkUploader.prototype = new Queueable();

    return ChunkUploader;
});