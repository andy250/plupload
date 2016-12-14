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

                self.getChunkUploadUrl(function (url) {
                    _xhr = new XMLHttpRequest();

                    if (_xhr.upload) {
                        _xhr.upload.onprogress = function (e) {
                            self.progress(e.loaded, e.total);
                        };
                    }

                    _xhr.onload = function () {
                        var result = {
                            response: _xhr.responseText,
                            status: _xhr.status,
                            responseHeaders: _xhr.getAllResponseHeaders()
                        };

                        if (_xhr.status >= 400) { // assume error
                            return self.failed(result);
                        }

                        self.done(result);
                    };

                    _xhr.onerror = function () {
                        self.failed({
                            status: 503     // service unavailable
                        });
                    };

                    _xhr.onloadend = function () {
                        _xhr = null;
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

                        _xhr.send(_blob);
                    }
                });
            },


            stop: function () {
                ChunkUploader.prototype.stop.call(this);

                if (_xhr) {
                    _xhr.abort();
                    _xhr = null;
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