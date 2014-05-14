/*global nativeRequire*/
define(function(require, exports, module) {
    main.consumes = ["Plugin", "menus", "layout", "preferences", "settings"];
    main.provides = ["nativeMenus"];
    return main;

    function main(options, imports, register) {
        var Plugin = imports.Plugin;
        var menus = imports.menus;
        var layout = imports.layout;
        var settings = imports.settings;
        var prefs = imports.preferences;

        // Some require magic to get nw.gui
        var nw = nativeRequire("nw.gui"); 
        var keys = require("ace/lib/keys");
        
        // Ref to window
        var win = nw.Window.get();
        var server = window.server;
        var windowManager = server.windowManager;
        
        var specialKeys = {
            " ": 32,
            "delete": 0x7F,
            "backspace": 0x08,
            "down": 63233,
            "up": 63232,
            "left": 63234,
            "right": 63235,
            "f1": 63236,
            "f2": 63237,
            "f3": 63238,
            "f4": 63239,
            "f5": 63240,
            "f6": 63241,
            "f7": 63242,
            "f8": 63243,
            "f9": 63244,
            "f10": 63245,
            "f11": 63246,
            "f12": 63247,
            "home": 63273,
            "end": 63275,
            "pagedown": 63277,
            "pageup": 63276
        };
        
        /***** Initialization *****/
        
        var plugin = new Plugin("Ajax.org", main.consumes);
        // var emit = plugin.getEmitter();
        
        var loaded = false;
        function load(){
            if (loaded) return false;
            loaded = true;
            
            prefs.add({
                "General" : {
                    "User Interface" : {
                        "Use Native Menus (restart required)" : {
                            type: "checkbox",
                            path: "user/local/@nativeMenus",
                            position: 50
                        }
                    }
                }
            }, plugin);
            
            settings.on("read", function(){
                settings.setDefaults("user/local", [["nativeMenus", true]]);
                
                init();
            });
        }
        
        function init(){
            // Only do this for OSX
            if (process.platform != "darwin" 
              || !settings.getBool("user/local/@nativeMenus")) {
                
                // Create Root Menus
                menus.init();
                
                // Create Built In Menus
                windowManager.connection.send(0, {
                    type: "builtin"
                });
                  
                return;
            }

            function decorateMenu(menu, basename) {
                menu.native = true;
                
                menu.on("DOMNodeInserted", function(e) {
                    var node = e.currentTarget;
                    if (node.nodeType != 1 || node.native) return;
                    
                    createMenuItem({
                        name: basename + "/" + (node.caption || "~" + node.$position),
                        parent: menu,
                        item: node,
                        index: node.$position
                    });
                });
                
                menu.on("DOMNodeRemoved", function(e) {
                    var node = e.currentTarget;
                    windowManager.connection.send(0, {
                        type: "remove",
                        id: node.$uniqueId // @todo path
                    });
                });
            }
            
            menus.on("root", function(e) {
                if (e.index < 1000) {
                    // @todo move to when native menu is shown
                    if (!e.menu.$ext)
                        apf.document.documentElement.appendChild(e.menu);
                    
                    windowManager.connection.send(0, {
                        type: "setRoot",
                        name: e.name,
                        index: e.index
                    });
                    
                    decorateMenu(e.menu, e.name);
                    
                    return false;
                }
            });
            
            menus.on("submenu", function(e) {
                if (e.parent.native && e.index) {
                    // @todo move to when native menu is shown
                    if (!e.parent.$ext)
                        apf.document.documentElement.appendChild(e.parent);
                    if (!e.menu.$ext)
                        apf.document.documentElement.appendChild(e.menu);
                    
                    windowManager.connection.send(0, {
                        type: "setSubMenu",
                        name: e.name,
                        index: e.index
                    });
                    
                    decorateMenu(e.menu, e.name);
                }
            });
            
            menus.on("menuitem", createMenuItem);
            
            // Create Root Menus
            menus.init();
            
            // Click Dispatcher
            win.on("menuClick", function(e) {
                var item = menus.get(e.name).item;
                if (!item) throw new Error();
                
                var type = item.getAttribute("type");
                if (type == "check")
                    item[item.checked ? "uncheck" : "check"]();
                else if (type == "radio")
                    item.select();
                
                item.dispatchEvent("click");
                
                item.parentNode.dispatchEvent("itemclick", {
                    value: item.value
                });
            });
            
            // Show Dispatcher
            win.on("menuShow", function(msg) {
                var menu = menus.get(msg.name).menu;
                if (!menu) throw new Error();
                
                // Update AML Menu
                menu.dispatchEvent("prop.visible", { value: true });
                
                // Collect State
                var items = [];

                var nodes = menu.childNodes;
                for (var n, i = nodes.length - 1; i >= 0; i--) {
                    n = nodes[i];
                    
                    if (n.localName != "item" && n.localName != "divider")
                        continue;
                    
                    if (!n.originalName)
                        n.originalName = msg.name + "/" + (n.caption || "~" + n.$position);
                    
                    var data = {
                        name: n.originalName,
                        index: n.$position,
                        visible: n.visible,
                        caption: n.caption,
                        key: n.key,
                        modifiers: n.modifiers,
                        checked: n.checked || n.selected || n.selectedItem == n,
                        disabled: n.disabled
                    }
                    
                    if (!n.key && n.hotkey)
                        setHotkey(data, n.hotkey);
                    
                    items.push(data);
                }
                
                // Send to Root window
                windowManager.connection.send(0, {
                    type: "showMenu",
                    name: msg.name,
                    items: items
                });
            });
        }
        
        /***** Methods *****/
        
        function createMenuItem(e){
            var item = e.item;
            
            if (e.parent.native && (item.localName == "item" 
              || item.localName == "divider")) {
                
                item.native = true; // Prevent re-entry
                item.originalName = e.name; // Used as an item id
                
                var data = {
                    type: "setMenuItem",
                    name: e.name,
                    index: e.index,
                    disabled: item.disabled,
                    itemtype: item.type,
                    selector: item.selector,
                    key: item.key,
                    modifiers: item.modifiers
                    // hotkey: item.hotkey
                };
                if (!item.key && item.hotkey)
                    setHotkey(data, item.hotkey);
                    
                windowManager.connection.send(0, data);
            }
        }
        
        function setHotkey(item, hotkey) {
            // item.cached = hotkey;
    
            hotkey = hotkey.split("|")[0];
            var isUpper = ~hotkey.indexOf("Shift");
            hotkey = hotkey.replace(/Shift[- ]?/, "").split(/[- ]/);
            
            item.key = hotkey.pop().toLowerCase() || "-";
            if (specialKeys[item.key]) {
                item.key = String.fromCharCode(specialKeys[item.key]);
                if (isUpper) hotkey.push("shift");
            }
            else if (item.key.length > 1) {
                item.key = String.fromCharCode(keys[item.key]);
                if (isUpper) hotkey.push("shift");
            }
            else if (isUpper) 
                item.key = item.key.toUpperCase();
                
            item.modifiers = hotkey.map(function(key) {
                if (key == "Command") return "cmd";
                if (key == "Option") return "alt";
                if (key == "Alt") return "alt";
                if (key == "Ctrl") return "ctrl";
                return key;
            }).join("-");
        }
        
        /***** Lifecycle *****/
        
        plugin.on("load", function(){
            load();
        });
        plugin.on("enable", function(){
            
        });
        plugin.on("disable", function(){
            
        });
        plugin.on("unload", function(){
            loaded = false;
        });
        
        /***** Register and define API *****/
        
        /**
         **/
        plugin.freezePublicAPI({
        });
        
        register(null, {
            nativeMenus: plugin
        });
    }
});