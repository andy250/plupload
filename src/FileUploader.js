/**
 * FileUploader.js
 *
 * Copyright 2015, Moxiecode Systems AB
 * Released under GPL License.
 *
 * License: http://www.plupload.com/license
 * Contributing: http://www.plupload.com/contributing
 */

/**
 * @class plupload.FileUploader
 * @extends plupload.core.Queueable
 * @constructor
 * @since 3.0
 * @final
 */
define('plupload/FileUploader', [
	'moxie/core/utils/Basic',
	'plupload/core/Collection',
	'plupload/core/Queueable',
	'plupload/ChunkUploader'
], function(Basic, Collection, Queueable, ChunkUploader) {


	function FileUploader(fileRef, queue) {
		var _file = fileRef;
		var _chunks = new Collection();
		var _chunkSize = 0;
		var _totalChunks = 1;
		var _waitHandle = null;

		Queueable.call(this);

		this._options = {
			url: false,
			chunk_size: 0,
			multipart: true,
			multipart_append_params: true,
			http_method: 'POST',
			params: {},
			headers: false,
			file_data_name: 'file',
			send_file_name: true,
			stop_file_on_chunk_fail: true
		};

		Basic.extend(this, {

			/**
			Unique identifier

			@property uid
			@type {String}
            */
			uid: Basic.guid(),

			/**
			When send_file_name is set to true, will be sent with the request as `name` param.
            Can be used on server-side to override original file name.

            @property name
			@type {String}
            */
			name: _file.name,


			start: function(options) {
				var self = this;
				var up;

				self.setOptions(options);

				// chunk size cannot be modified for a file once set
				_chunkSize = self.getOption('chunk_size');

				FileUploader.prototype.start.call(self);

				// send additional 'name' parameter only if required or explicitly requested
				if (self.getOption('send_file_name')) {
					self._options.params.name = self.target_name || self.name;
				}

				_totalChunks = _chunkSize ? Math.ceil(_file.size / _chunkSize) : 1;
				self.uploadChunk(0);
			},


			uploadChunk: function(seq) {
				var self = this;
				var up;
				var chunk = self.chunkInfo(seq);

				// do not proceed for weird chunks
				if (chunk.start < 0 || chunk.start >= _file.size) {
					return false;
				}

				var chunkUploaderOptions = Basic.extendImmutable({}, this.getOptions(), {
					params: {
						chunk: chunk.seq,
						chunks: _totalChunks
					}
				});

				up = new ChunkUploader(_file.slice(chunk.start, chunk.end, _file.type), chunkUploaderOptions, chunk);
				chunk.uid = up.uid;

				up.bind('progress', function(e) {
					self.progress(calcProcessed(), _file.size);
				});

				up.bind('failed', function(e, result) {
					_chunks.add(chunk.seq, Basic.extend({
						state: Queueable.FAILED
					}, chunk));

					if (this.getOption('stop_file_on_chunk_fail')) {
						self.failed(result);
					}
				});

				up.bind('aborted', function(e, result) {
					if (Basic.inArray(result.status, [503, 599]) > -1) {
						// server unavialable
						this.serverDisconnected();
					} else {
						// chunk uploader reported error after all retries failed - fail the whole file
						self.failed(result);
					}
				});

				up.bind('done', function(e, result) {
					_chunks.add(chunk.seq, Basic.extend({
						state: Queueable.DONE
					}, chunk));

					if (calcProcessed() >= _file.size) {
						self.progress(_file.size, _file.size);
						self.done(result);
					} else if (_chunkSize) {
						Basic.delay(function() {
							self.uploadChunk(getNextChunk());
						});
					}
				});

				up.bind('completed', function() {
					this.destroy();
				});

				_chunks.add(chunk.seq, Basic.extend({
					state: Queueable.PROCESSING
				}, chunk));

				queue.addItem(up);

				// enqueue even more chunks if slots available
				if (queue.countSpareSlots()) {
					self.uploadChunk(getNextChunk());
				}

				return true;
			},

			setOption: function(option, value) {
				if (typeof(option) !== 'object' && !this._options.hasOwnProperty(option)) {
					return;
				}
				FileUploader.prototype.setOption.apply(this, arguments);
			},

			chunkInfo: function (seq) {
				var start;
				var end;

				seq = parseInt(seq, 10) || getNextChunk();
				start = seq * _chunkSize;
				end = Math.min(start + _chunkSize, _file.size);
				
				return {
					seq: seq,
					start: start,
					end: end,
					size: end - start,
					chunks: _totalChunks, 
					filesize: _file.size,
					filename: _file.relativePath || _file.name //relativePath is '' in e.g. IE
				};
			},

			destroy: function() {
				if (this.state !== Queueable.DESTROYED) {
					_chunks.each(function (item) {
						queue.removeItem(item.uid);
					});
					queue = _file = null;
					FileUploader.prototype.destroy.call(this);
				}
			}
		});


		function calcProcessed() {
			var processed = 0;

			_chunks.each(function(item) {
				var chunk = queue.getItem(item.uid);
				processed += chunk ? (chunk.processed || 0) : 0;
			});

			return processed;
		}


		function getNextChunk() {
			var i = 0;
			while (i < _totalChunks && _chunks.hasKey(i)) {
				i++;
			}
			return i;
		}

	}


	FileUploader.prototype = new Queueable();

	return FileUploader;
});