﻿// jquery.continuations v0.4.9
//
// Copyright (C)2011 Joshua Arnold, Jeremy Miller
// Distributed Under Apache License, Version 2.0
//
// https://github.com/DarthFubuMVC/jquery-continuations

(function ($) {

    "use strict";

    // Sanity check of dependencies
    if (typeof ($) !== 'function') {
        throw 'jQuery.continuations: jQuery not found.';
    }

    var CORRELATION_ID = 'X-Correlation-Id';
    var policies = [];
	
	var theContinuation = function () { };
    theContinuation.prototype = {
        success: false,
        errors: [],
        refresh: false,
        correlationId: null,
		options: {},
		matchOnProperty: function(prop, predicate) {
			return typeof(this[prop]) !== 'undefined' && predicate(this[prop]);
		},
        isCorrelated: function () {
			return this.matchOnProperty('correlationId', function(id) {
				return id != null;
			});
        }
    };

    var refreshPolicy = function () {
        this.matches = function (continuation) {
            return continuation.refresh && continuation.refresh.toString() === 'true';
        };
        this.execute = function (continuation) {
            $.continuations.windowService.refresh();
        };
    };

    var navigatePolicy = function () {
        this.matches = function (continuation) {
            return continuation.navigatePage != undefined && continuation.navigatePage != '';
        };
        this.execute = function (continuation) {
            $.continuations.windowService.navigateTo(continuation.navigatePage);
        };
    };

    var errorPolicy = function () {
        this.matches = function (continuation) {
            return continuation.errors && continuation.errors.length != 0;
        };
        this.execute = function (continuation) {
            $.continuations.trigger('ContinuationError', continuation);
        };
    };

    var continuations = function () { 
        this.callbacks = {};
    };
    continuations.prototype = {
        // I'm calling YAGNI on the unbind since we have a reset
        bind: function(topic, callback) {
            if( !this.callbacks[topic] ) {
                this.callbacks[topic] = [];
            }
            
            this.callbacks[topic].push(callback);
        },
        // Mostly public for testing
        trigger: function(topic, payload) {
            if( !this.callbacks[topic] ) {
                return;
            }
            
            var actions = this.callbacks[topic];
            for(var i = 0; i < actions.length; i++) {
                actions[0](payload);
            }
        },
        init: function () {
            var self = this;
            $(document).ajaxComplete(function (e, xhr, options) {
                self.trigger('AjaxCompleted', {
                    correlationId: xhr.getResponseHeader(CORRELATION_ID)
                });
            });
            
            $.ajaxSetup({
                cache: false,
                success: function (continuation, status, jqXHR) {
					var options = this.options;
					if(typeof(options) === 'undefined') {
						options = {};
					}
					if(typeof(continuation) !== 'undefined') {
						continuation.options = options;
					}
					
                    self.onSuccess({
                        continuation: continuation,
						callback: this.continuationSuccess,
                        status: status,
                        response: jqXHR
                    });
                },
                beforeSend: function (xhr, settings) {
                    self.setupRequest(xhr, settings);
                }
            });

            this.setupDefaults();
        },
        setupDefaults: function () {
            this.applyPolicy(new refreshPolicy());
            this.applyPolicy(new navigatePolicy());
            this.applyPolicy(new errorPolicy());
        },
        onSuccess: function (msg) {
            var contentType = msg.response.getResponseHeader('Content-Type');
            if (!contentType || contentType.indexOf('json') == -1) {
                return;
            }

            var continuation = msg.continuation;
            continuation.correlationId = msg.response.getResponseHeader('X-Correlation-Id');
			
			if($.isFunction(msg.callback)) {
				msg.callback(continuation);
			}

            this.process(continuation);
        },
        // Keep this public for form correlation
        setupRequest: function (xhr, settings) {
            // this could come from the ajax options
            var id = settings.correlationId;
            if (typeof(id) === 'undefined') {
                id = new Date().getTime().toString();
            }
            xhr.setRequestHeader(CORRELATION_ID, id);
            $.continuations.trigger('AjaxStarted', {
                correlationId: id
            });
        },
        applyPolicy: function (policy) {
            policies.push(policy);
            return this;
        },
		// Mostly for testing
		reset: function() {
			policies.length = 0;
			this.setupDefaults();
            this.callbacks = {};
		},
        process: function (continuation) {
			var standardContinuation = new $.continuations.continuation();
			continuation = $.extend(standardContinuation, continuation);
            var matchingPolicies = [];
            for (var i = 0; i < policies.length; ++i) {
                var p = policies[i];
                if (p.matches(continuation)) {
                    matchingPolicies.push(p);
                }
            }

            for (var i = 0; i < matchingPolicies.length; ++i) {
                matchingPolicies[i].execute(continuation);
            }
        }
    };

    continuations.prototype.windowService = {
        refresh: function () {
            window.location.reload();
        },
        navigateTo: function (url) {
            window.location = url;
        }
    };
    
    var module = new continuations();
    module.init();


    // Exports
    $.continuations = module;
    $.continuations.fn = continuations.prototype;
	$.continuations.continuation = theContinuation;
	
	$.fn.correlatedSubmit = function (options) {
		if(typeof(options) === 'undefined') {
			options = {};
		}
		
        return this.each(function () {
            var self = $(this);
            var correlationId = options.correlationId;
            if (typeof(correlationId) === 'undefined') {
                var id = self.attr('id');
                if (!id) {
                    id = 'form_' + new Date().getTime().toString();
                    self.attr('id', id);
                }

                correlationId = id;
            }

            self.ajaxSubmit({
				correlationId: correlationId,
				continuationSuccess: function(continuation) {
					continuation.form = self;
					continuation.options = options;
					
					if($.isFunction(options.continuationSuccess)) {
						options.continuationSuccess(continuation);
					}
				}
            });
        });
    };
} (jQuery));