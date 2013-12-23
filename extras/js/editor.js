// Generated by CoffeeScript 1.6.3
(function() {
  var Editor, Range, getCssRule;

  Range = ace.require('ace/range').Range;

  getCssRule = (function() {
    var cache;
    cache = {};
    return function(selector) {
      var sheets;
      sheets = [].slice.call(document.styleSheets);
      sheets.forEach(function(sheet) {
        var rules, _ref;
        rules = [].slice.call((_ref = sheet.cssRules) != null ? _ref : sheet.rules);
        return rules.forEach(function(rule) {
          if (rule.selectorText && rule.selectorText.indexOf(selector) !== -1) {
            return cache[selector] = rule;
          }
        });
      });
      return cache[selector];
    };
  })();

  window.Editor = Editor = (function() {
    function Editor(id) {
      var _this = this;
      this.editor = ace.edit(id);
      this.editor.setTheme('ace/theme/github');
      this.editor.setPrintMarginColumn(-1);
      this.editor.setSelectionStyle('text');
      this.editor.session.setTabSize(2);
      this.editor.session.setUseWrapMode(true);
      this.editor.session.setMode('ace/mode/coffee');
      this.editor.commands.addCommand({
        bindKey: {
          mac: 'Command+Enter',
          win: 'Alt+Enter'
        },
        name: 'run',
        exec: function() {
          var _base;
          return typeof (_base = _this._callback)['run'] === "function" ? _base['run']() : void 0;
        }
      });
      this.editor.commands.addCommand({
        bindKey: {
          mac: 'Command+.',
          win: 'Alt+.'
        },
        name: 'reset',
        exec: function() {
          var _base;
          return typeof (_base = _this._callback)['reset'] === "function" ? _base['reset']() : void 0;
        }
      });
      this._callback = {};
    }

    Editor.prototype.on = function(event, callback) {
      return this._callback[event] = callback;
    };

    Editor.prototype.getValue = function() {
      return this.editor.getValue().trim();
    };

    Editor.prototype.clear = function() {
      return this.editor.setValue('');
    };

    Editor.prototype.setSourceCode = function(code) {
      this.editor.setValue(code);
      this.editor.clearSelection();
      return this.editor.moveCursorTo(0, 0);
    };

    Editor.prototype.getSmartRegion = function() {
      var begin, end, range, session, _ref,
        _this = this;
      session = this.editor.session;
      range = this.editor.getSelectionRange();
      if (range.isEmpty()) {
        _ref = this.findRange(session, range.start.row), begin = _ref[0], end = _ref[1];
        if (begin !== null) {
          this.editor.getSelection().setSelectionRange(new Range(begin, 0, end, Infinity));
        }
      }
      this.blink('.ace_marker-layer .ace_selection', function() {
        return _this.editor.getSelection().setSelectionRange(range);
      });
      return session.getTextRange(this.editor.getSelectionRange());
    };

    Editor.prototype.findRange = function(session, begin) {
      var code, depth, e, end, i, last, line, lookAt, _i, _ref;
      lookAt = begin;
      end = begin;
      last = session.getLength();
      depth = 0;
      while (true) {
        line = session.getLine(lookAt);
        for (i = _i = 0, _ref = line.length; 0 <= _ref ? _i < _ref : _i > _ref; i = 0 <= _ref ? ++_i : --_i) {
          switch (line.charAt(i)) {
            case "(":
            case "[":
            case "{":
              depth += 1;
              break;
            case "}":
            case "]":
            case ")":
              depth -= 1;
          }
        }
        if (depth === 0) {
          code = session.getLines(begin, end).join('\n');
          break;
        } else if (depth < 0) {
          begin -= 1;
          if (begin < 0) {
            break;
          }
          lookAt = begin;
        } else {
          end += 1;
          if (end > last) {
            break;
          }
          lookAt = end;
        }
      }
      if (code) {
        try {
          CoffeeScript.tokens(code);
          return [begin, end];
        } catch (_error) {
          e = _error;
          console.log(e.toString());
        }
      }
      return [null, null];
    };

    Editor.prototype.blink = function(selector, callback) {
      var rule;
      rule = getCssRule(selector);
      if (rule) {
        setTimeout(function() {
          rule.style.setProperty('-webkit-animation', null);
          return callback();
        }, 250);
        return rule.style.setProperty('-webkit-animation', 'blink 0.5s');
      }
    };

    return Editor;

  })();

}).call(this);
