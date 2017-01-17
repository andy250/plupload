/**
 * File.js
 *
 * Copyright 2015, Moxiecode Systems AB
 * Released under GPL License.
 *
 * License: http://www.plupload.com/license
 * Contributing: http://www.plupload.com/contributing
 */

/**
 * @class plupload.File
 * @extends plupload.core.Queueable
 * @constructor
 * @since 3.0
 * @final
 */
define('plupload/File', [
    'plupload',
    'plupload/core/Queueable',
    'plupload/FileUploader',
    'plupload/ImageResizer'
], function(plupload, Queueable, FileUploader, ImageResizer) {


    function File(fileRef, queueUpload, queueResize) {
        var _up = null;
        var _file = fileRef;
        var _uid = plupload.guid();

        Queueable.call(this);

        plupload.extend(this, {
            /**
             * For backward compatibility
             *
             * @property id
             * @type {String}
             * @deprecated
             */
            id: _uid,

            /**
             Unique identifier

             @property uid
             @type {String}
             */
            uid: _uid,

            /**
             When send_file_name is set to true, will be sent with the request as `name` param.
             Can be used on server-side to override original file name.

             @property name
             @type {String}
             */
            name: _file.name,

            /**
             @property target_name
             @type {String}
             @deprecated use name
             */
            target_name: null,

            /**
             * File type, `e.g image/jpeg`
             *
             * @property type
             * @type String
             */
            type: _file.type,

            /**
             * File size in bytes (may change after client-side manupilation).
             *
             * @property size
             * @type Number
             */
            size: _file.size,

            total: _file.size,

            /**
             * Original file size in bytes.
             *
             * @property origSize
             * @type Number
             */
            origSize: _file.size,


            start: function(options) {
                var self = this;

                if (options) {
                    this.setOptions(options);
                }

                if (!plupload.isEmptyObj(options.resize) && isImage(this.type) && runtimeCan(_file, 'send_binary_string')) {
                    this.resizeAndUpload();
                } else {
                    this.upload();
                }

                File.prototype.start.call(self);
            },

            /**
             * Get the file for which this File is responsible
             *
             * @method getSource
             * @returns {moxie.file.File}
             */
            getSource: function() {
                return _file;
            },

            /**
             * Returns file representation of the current runtime. For HTML5 runtime
             * this is going to be native browser File object
             * (for backward compatibility)
             *
             * @method getNative
             * @deprecated
             * @returns {File|Blob|Object}
             */
            getNative: function() {
                return this.getFile().getSource();
            },


            resizeAndUpload: function() {
                var self = this;
                var rszr = new ImageResizer(_file);

                rszr.bind('progress', function(e) {
                    self.progress(e.loaded, e.total);
                });

                rszr.bind('done', function(e, file) {
                    _file = file;
                    self.upload();
                });

                rszr.bind('failed', function(e, result) {
                    self.upload();
                });

                queueResize.addItem(rszr);
            },


            upload: function() {
                var self = this;
                _up = new FileUploader(_file, queueUpload);

                _up.bind('progress', function(e) {
                    self.progress(e.loaded, e.total);
                });

                _up.bind('done', function(e, result) {
                    self.done(result);
                });

                _up.bind('failed', function(e, result) {
                    this.destroy();
                    self.failed(result);
                });

                _up.bind('completed', function(e, result) {
                    self.completed(result);
                });

                _up.start(self.getOptions());
            },

            stop: function () {
                File.prototype.stop.call(this);
            },

            destroy: function() {
                File.prototype.destroy.call(this);
                if (_up) {
                    _up.destroy();
                    _up = null;
                }
                _file = null;
            },

            rename: function (newName) {
                var oldName = _file.name;
                _file.name = newName;
                if (_file.relativePath) {
                    _file.relativePath = _file.relativePath.substring(0, _file.relativePath.length - oldName.length) + newName;
                }
                this.name = _file.name;
            }
        });
    }


    function isImage(type) {
        return plupload.inArray(type, ['image/jpeg', 'image/png']) > -1;
    }


    function runtimeCan(blob, cap) {
        if (blob.ruid) {
            var info = plupload.Runtime.getInfo(blob.ruid);
            if (info) {
                return info.can(cap);
            }
        }
        return false;
    }


    File.prototype = new Queueable();

    return File;
});