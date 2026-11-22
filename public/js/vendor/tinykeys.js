//#region src/tinykeys.ts
/**
* These are the modifier keys that change the meaning of keybindings.
*
* Note: Ignoring "AltGraph" because it is covered by the others.
*/
let KEYBINDING_MODIFIER_KEYS = [
	"Shift",
	"Meta",
	"Alt",
	"Control"
];
/**
* Keybinding sequences should timeout if individual key presses are more than
* 1s apart by default.
*/
let DEFAULT_TIMEOUT = 1e3;
/**
* Keybinding sequences should bind to this event by default.
*/
let DEFAULT_EVENT = "keydown";
/**
* Platform detection code.
* @see https://github.com/jamiebuilds/tinykeys/issues/184
*/
let PLATFORM = typeof navigator === "object" ? navigator.platform : "";
/**
* An alias for creating platform-specific keybinding aliases.
*/
let MOD = /Mac|iPod|iPhone|iPad/.test(PLATFORM) ? "Meta" : "Control";
/**
* Meaning of `AltGraph`, from MDN:
* - Windows: Both Alt and Ctrl keys are pressed, or AltGr key is pressed
* - Mac: ⌥ Option key pressed
* - Linux: Level 3 Shift key (or Level 5 Shift key) pressed
* - Android: Not supported
* @see https://github.com/jamiebuilds/tinykeys/issues/185
*/
let ALT_GRAPH_ALIASES = PLATFORM === "Win32" ? ["Control", "Alt"] : ["Alt"];
/**
* Ensure and stop any event that isn't a full keyboard event.
* Autocomplete option navigation and selection would fire an Event,
* instead of the expected KeyboardEvent
*/
function isKeyboardEvent(event) {
	return !!(event.key && event.code && event.getModifierState);
}
/**
* Ignores keyboard events from contenteditable and form elements unless they
* are the current target.
*/
function defaultKeybindingsHandlerIgnore(event) {
	let target = event.target;
	return event.repeat || event.isComposing || target !== event.currentTarget && target.matches("[contenteditable],input,select,textarea");
}
/**
* There's a bug in Chrome that causes event.getModifierState not to exist on
* KeyboardEvent's for F1/F2/etc keys.
*/
function getModifierState(event, mod) {
	return typeof event.getModifierState === "function" ? event.getModifierState(mod) || ALT_GRAPH_ALIASES.includes(mod) && event.getModifierState("AltGraph") : false;
}
/**
* Parses a keybinding string into its parts.
*
* ```
* grammar    = `<sequence>`
* <sequence> = `<press> <press> <press> ...`
* <press>    = `<key>` or `<mods>+<key>`
* <mods>     = `<mod>+<mod>+...`
* <mod>      = `<modifier>` (required) or `[<modifier>]` (optional)
* <key>      = `<KeyboardEvent.key>` or `<KeyboardEvent.code>` (case-insensitive)
* <key>      = `(<regex>)` -> `/^(?:<regex>)$/iy` (case-insensitive)
* ```
*/
function parseKeybinding(str) {
	return str.trim().split(" ").map((press) => {
		let parts = press.split(/(?<=\w|\])\+/);
		let last = parts.pop();
		let regex = last.match(/^\((.+)\)$/);
		let key = regex ? new RegExp(`^(?:${regex[1]})$`, "iv") : last;
		let requiredModifiers = [];
		let optionalModifiers = [];
		for (const part of parts) {
			let optional = part.match(/^\[(.*)\]$/);
			let mod = optional?.[1] ?? part;
			mod = mod === "$mod" ? MOD : mod;
			if (optional) optionalModifiers.push(mod);
			else requiredModifiers.push(mod);
		}
		return [
			requiredModifiers,
			optionalModifiers,
			key
		];
	});
}
/**
* This tells us if a single keyboard event matches a single keybinding press.
*/
function matchKeybindingPress(event, [requiredModifiers, optionalModifiers, key]) {
	const hasAltGraph = requiredModifiers.includes("AltGraph");
	return !((key instanceof RegExp ? !(key.test(event.key) || key.test(event.code)) : key.toUpperCase() !== event.key.toUpperCase() && key !== event.code) || requiredModifiers.find((mod) => {
		return !getModifierState(event, mod);
	}) || KEYBINDING_MODIFIER_KEYS.find((mod) => {
		return !requiredModifiers.includes(mod) && !optionalModifiers.includes(mod) && key !== mod && getModifierState(event, mod) && !(hasAltGraph && ALT_GRAPH_ALIASES.includes(mod));
	}));
}
/**
* Creates an event listener for handling keybindings.
*
* @example
* ```js
* import { createKeybindingsHandler } from "../src/keybindings"
*
* let handler = createKeybindingsHandler({
* 	"Shift+d": () => {
* 		alert("The 'Shift' and 'd' keys were pressed at the same time")
* 	},
* 	"y e e t": () => {
* 		alert("The keys 'y', 'e', 'e', and 't' were pressed in order")
* 	},
* 	"$mod+d": () => {
* 		alert("Either 'Control+d' or 'Meta+d' were pressed")
* 	},
* })
*
* window.addEventListener("keydown", handler)
* ```
*/
function createKeybindingsHandler(keybindingsMap, options = {}) {
	let timeout = options.timeout ?? DEFAULT_TIMEOUT;
	let ignore = options.ignore ?? defaultKeybindingsHandlerIgnore;
	let keybindings = Object.keys(keybindingsMap).map((input) => {
		return [
			input,
			parseKeybinding(input),
			keybindingsMap[input]
		];
	});
	let pending = /* @__PURE__ */ new Map();
	let timer = null;
	return (event) => {
		if (!isKeyboardEvent(event) || ignore(event)) return;
		let conflicts = [];
		for (let [input, sequence, handler] of keybindings) {
			let prev = pending.get(input);
			let [current, ...rest] = prev ? prev : sequence;
			if (!matchKeybindingPress(event, current)) {
				if (!getModifierState(event, event.key)) pending.delete(input);
			} else if (rest.length > 0) {
				pending.set(input, rest);
				conflicts.push(input);
			} else {
				pending.delete(input);
				if (conflicts.length) console.warn(`tinykeys: Conflict found, "${input}" did not fire, waiting for:`, conflicts);
				else {
					handler(event);
					break;
				}
			}
		}
		if (timer) clearTimeout(timer);
		timer = setTimeout(() => pending.clear(), timeout);
	};
}
/**
* Subscribes to keybindings.
*
* Returns an unsubscribe method.
*
* @example
* ```js
* import { tinykeys } from "../src/tinykeys"
*
* tinykeys(window, {
* 	"Shift+d": () => {
* 		alert("The 'Shift' and 'd' keys were pressed at the same time")
* 	},
* 	"y e e t": () => {
* 		alert("The keys 'y', 'e', 'e', and 't' were pressed in order")
* 	},
* 	"$mod+d": () => {
* 		alert("Either 'Control+d' or 'Meta+d' were pressed")
* 	},
* })
* ```
*/
function tinykeys(target, keybindingMap, options = {}) {
	let event = options.event ?? DEFAULT_EVENT;
	let onKeyEvent = createKeybindingsHandler(keybindingMap, options);
	target.addEventListener(event, onKeyEvent, options.capture);
	return () => {
		target.removeEventListener(event, onKeyEvent, options.capture);
	};
}
//#endregion
export { createKeybindingsHandler, defaultKeybindingsHandlerIgnore, matchKeybindingPress, parseKeybinding, tinykeys };

//# sourceMappingURL=tinykeys.mjs.map