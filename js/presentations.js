// TODO(fancycode): Should load through AMD if possible.
/* global OC, OCA */

(function(OCA, OC, $) {
	'use strict';

	OCA.SpreedMe = OCA.SpreedMe || {};

	var Presentation = function(id, token, url) {
		this.id = id;
		this.token = token;
		this.url = url;
		this.elem = null;
		this.numPages = 0;
		this.curPage = 1;
		this.scale = 1;
		this.isController = false;
		this.e = $({});
		this.e.byName = {
			LOAD: "load",
			PAGE_UPDATED: "page.updated",
			RENDERING_DONE: "rendering.done"
		};
	};
	Presentation.prototype.isLoaded = function() {
		throw 'isLoaded not implemented yet';
	};
	Presentation.prototype.allowControl = function(allow) {
		this.isController = allow;
	};
	Presentation.prototype.exactPage = function(num) {
		if (this.curPage === num || num <= 0 || num >= this.numPages) {
			return;
		}
		this.curPage = num;
		this.e.trigger(this.e.byName.PAGE_UPDATED, this.curPage);
	};

	var PDFPresentation = function(id, token, url) {
		Presentation.call(this, id, token, url);
		this.isRendering = false;
		var evs = [this.e.byName.LOAD, this.e.byName.PAGE_UPDATED];
		this.e.on(evs.join(" "), _.bind(this.render, this));
	};
	PDFPresentation.prototype = Object.create(Presentation.prototype);
	PDFPresentation.prototype.isLoaded = function() {
		return !!this.doc;
	};
	PDFPresentation.prototype.load = function(cb) {
		if (this.isLoaded()) {
			// Immediately call callback
			cb();
			return;
		}
		try {
			PDFJS.getDocument(this.url).then(_.bind(function (doc) {
				this.doc = doc;
				this.numPages = this.doc.numPages;
				this.e.trigger(this.e.byName.LOAD, this.curPage);
				cb();
			}, this));
		} catch (e) {
			// TODO(leon): Handle this.
		}
	};
	PDFPresentation.prototype.render = function(e, page) {
		if (!this.isLoaded()) {
			console.log("Not loaded yet");
			return;
		}
		var renderingDoneEventName = this.e.byName.RENDERING_DONE;
		// Defer rendering if we're already rendering
		if (this.isRendering) {
			console.log("Deferring rendering job for page", page);
			var rerenderJobEventName = renderingDoneEventName + ".rerenderJob";
			var args = Array.prototype.slice.call(arguments);
			this.e
			.unbind(rerenderJobEventName)
			.one(rerenderJobEventName, _.bind(function() {
				console.log("Running deferred rendering job for page", page);
				this.render.apply(this, args);
			}, this));
			return;
		}

		console.log("Showing page", this.curPage);
		var setRenderingFunc = _.bind(function(r) {
			return _.bind(function() {
				this.isRendering = r;
				if (!r) {
					this.e.trigger(renderingDoneEventName);
				}
			}, this);
		}, this);
		this.doc.getPage(this.curPage).then(_.bind(function(page) {
			var viewport = page.getViewport(this.scale);
			this.elem.height = viewport.height;
			this.elem.width = viewport.width;
			setRenderingFunc(true)();
			page.render({
				canvasContext: this.elem.getContext('2d'),
				viewport: viewport,
			}).then(setRenderingFunc(false)).catch(setRenderingFunc(false));
		}, this));
	};

	OCA.SpreedMe.Presentations = (function() {
		var exports = {};
		var self = exports;
		var rootElem = document.getElementById("presentations");
		var DATACHANNEL_NAMESPACE = 'presentation';
		var EVENT_TYPE = exports.EVENT_TYPE = {
			PRESENTATION_CURRENT: "current", // Issued to inform new participants about current presentation / page
			PRESENTATION_ADDED: "added", // Indicates that a new presentation was added
			PRESENTATION_REMOVED: "removed", // Indicates that a presentation was removed
			PRESENTATION_SWITCH: "switch", // Indicates that we switched presentations
			PAGE: "page", // Indicates that the page changed
		};
		var EVENTS = {
			PAGE_NEXT: function(p) {
				if (p.isController) {
					exports.newEvent(EVENT_TYPE.PAGE, p.curPage + 1);
				}
			},
			PAGE_PREVIOUS: function(p) {
				if (p.isController) {
					exports.newEvent(EVENT_TYPE.PAGE, p.curPage - 1);
				}
			},
		};
		var SUPPORTED_DOCUMENT_TYPES = {
			// rendered by pdfcanvas directive
			"application/pdf": "pdf",
			// rendered by odfcanvas directive
			// TODO(fancycode): check which formats really work, allow all odf for now
			//"application/vnd.oasis.opendocument.text": "odf",
			//"application/vnd.oasis.opendocument.spreadsheet": "odf",
			//"application/vnd.oasis.opendocument.presentation": "odf",
			//"application/vnd.oasis.opendocument.graphics": "odf",
			//"application/vnd.oasis.opendocument.chart": "odf",
			//"application/vnd.oasis.opendocument.formula": "odf",
			//"application/vnd.oasis.opendocument.image": "odf",
			//"application/vnd.oasis.opendocument.text-master": "odf"
		};

		var sharedPresentations = {
			active: null,
			staging: null,
			byId: {},
			withActive: function(cb) {
				if (this.active) {
					cb(this.active);
				}
			},
			init: function(id, p) {
				this.byId[id] = p;
				var c = document.createElement("canvas");
				c.id = "presentation_" + id;
				p.elem = c;
				p.elem.addEventListener("click", function(e) {
					var half = (p.elem.offsetWidth / 2);
					if (e.offsetX > half) {
						EVENTS.PAGE_NEXT(p);
					} else {
						EVENTS.PAGE_PREVIOUS(p);
					}
				}, true);
				this.hide(p);
				rootElem.appendChild(c);
			},
			add: function(id, p) {
				if (!this.byId.hasOwnProperty(id)) {
					// We don't have this presentation yet
					this.init(id, p);
				} else {
					// Reuse existing presentation
					p = this.byId[id];
				}
				// TODO(leon): Remove 'true' and add presentation selector instead
				if (true || !this.active) {
					this.show(p);
				}
			},
			remove: function(id) {
				if (!this.byId.hasOwnProperty(id)) {
					console.log("Remove: Unknown ID", id);
					return;
				}
				var p = this.byId[id];
				if (p === this.active) {
					p.hide();
				}
				p.elem.parentNode.removeChild(p.elem);
				delete this.byId[id];
			},
			removeAll: function() {
				for (var id in this.byId) {
					if (this.byId.hasOwnProperty(id)) {
						this.remove(id);
					}
				}
			},
			show: function(p) {
				if (p === this.active) {
					// Presentation is already active, do nothing
					return;
				}
				this.staging = p;
				p.load(_.bind(function() {
					// Check if we still want to show this presentation, migth have changed since
					if (this.staging !== p) {
						return;
					}
					this.staging = null;
					if (this.active) {
						this.hide(this.active);
					}
					this.active = p;
					this.active.elem.classList.remove("hidden");
				}, this));
			},
			showById: function(id) {
				if (!this.byId.hasOwnProperty(id)) {
					// TODO(leon): Handle error
					return;
				}
				this.show(this.byId[id]);
			},
			hide: function(p) {
				if (p === this.active) {
					// TODO(leon): We should simply show one of the next presentation
					this.active = null;
				}
				p.elem.classList.add("hidden");
			},
		};
		var isSanitizedToken = function(token) {
			return /^[a-z0-9]+$/i.test(token);
		};
		var makeDownloadUrl = function(token) {
			return OC.generateUrl("s/" + token + "/download");
		};

		document.addEventListener("keydown", function(e) {
			// Only do something if we have an active presentation
			var p = sharedPresentations.active;
			if (!p) {
				return;
			}
			switch (e.keyCode) {
			case 37: // Left arrow
				EVENTS.PAGE_PREVIOUS(p);
				break;
			case 39: // Right arrow
				EVENTS.PAGE_NEXT(p);
				break;
			}
		}, true);

		exports.newEvent = function(type, payload) {
			// Inform self
			self.handleEvent({type: type, payload: payload}, null); // TODO(leon): Replace null by own Peer object
			// Then inform others
			OCA.SpreedMe.webrtc.sendDirectlyToAll(DATACHANNEL_NAMESPACE, type, payload);
		};
		exports.handleEvent = function(data, from) {
			// TODO(leon): We might want to check if 'from' has permissions to emit the event
			switch (data.type) {
			case EVENT_TYPE.PRESENTATION_CURRENT:
				self.add(data.payload.token, from).then(function(p) {
					p.exactPage(data.payload.page);
				}); // TODO(leon): Might want to catch as well
				break;
			case EVENT_TYPE.PRESENTATION_ADDED:
				self.add(data.payload.token, from);
				break;
			case EVENT_TYPE.PRESENTATION_REMOVED:
				self.remove(data.payload, from);
				break;
			case EVENT_TYPE.PRESENTATION_SWITCH:
				sharedPresentations.showById(data.payload);
				break;
			case EVENT_TYPE.PAGE:
				sharedPresentations.withActive(function(p) {
					p.exactPage(data.payload);
				});
				break;
			default:
				console.log("Unknown presentation event '%s':", data.type, data.payload);
			}
		};

		exports.add = function(token, from) {
			if (!isSanitizedToken(token)) {
				// TODO(leon): Handle error
				console.log("Invalid token received", token);
				return;
			}
			var deferred = $.Deferred();
			var url = makeDownloadUrl(token);
			var p = new PDFPresentation(/* id */token, token, url);
			// TODO(leon): from === null means the event is from ourself
			// This should change, see other comment: "Replace null by own Peer object"
			p.allowControl(from === null);
			sharedPresentations.add(token, p);
			deferred.resolve(p); // TODO(leon): Make the sharedPresentations.add return a promise instead
			return deferred.promise();
		};

		var shareSelectedFiles = function(file) {
			// TODO(leon): There might be an existing API endpoint which we can use instead
			// This would make things simpler
			$.ajax({
				url: OC.linkToOCS('apps/spreed/api/v1', 2) + 'share',
				type: 'POST',
				data: {
					path: file,
				},
				beforeSend: function (req) {
					req.setRequestHeader('Accept', 'application/json');
				},
				success: function(res) {
					var token = res.ocs.data.token;
					exports.newEvent(
						EVENT_TYPE.PRESENTATION_ADDED,
						{token: token}
					);
				},
			});
		};

		var keepPosted = function(peers) {
			var type = EVENT_TYPE.PRESENTATION_CURRENT;
			var payload = {};
			sharedPresentations.withActive(function(p) {
				payload.token = p.token;
				payload.page = p.curPage;
			});
			peers.forEach(function(peer, i) {
				console.log("Informing directly", peer, payload);
				peer.sendDirectly(DATACHANNEL_NAMESPACE, type, payload);
			});
		};
		var openFilePicker = function() {
			var title = t('spreed', 'Please select the file(s) you want to share');
			var allowedFileTypes = [];
			for (var type in SUPPORTED_DOCUMENT_TYPES) {
				allowedFileTypes.push(type);
			}
			var config = {
				title: title,
				allowMultiSelect: false, // TODO(leon): Add support for this, ensure order somehow
				filterByMIME: allowedFileTypes,
			};
			OC.dialogs.filepicker(config.title, function(file) {
				console.log("Selected file", file);
				shareSelectedFiles(file);
			}, config.allowMultiSelect, config.filterByMIME);
		};
		exports.init = function(signaling) {
			this.signaling = signaling;
			this.signaling.on('usersJoined', function(users) {
				users.forEach(function(user, i) {
					var peers = OCA.SpreedMe.webrtc.getPeers(user.sessionId);
					keepPosted(peers);
				});
			});
			$('#presentation-button').click(function() {
				openFilePicker();
			});
		};

		return exports;
	})();

})(OCA, OC, $);