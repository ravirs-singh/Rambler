// ax-context: print JSON describing the focused text field of the frontmost app.
// Build: npm run build:helper:mac   (swiftc, needs Xcode command line tools)
// Needs the Accessibility permission (System Settings → Privacy & Security).
//
// Output: {"appName","bundleId","windowTitle","role","isEditable",
//          "beforeText","selectedText","afterText","helper":true}

import Cocoa
import ApplicationServices

func axString(_ element: AXUIElement, _ attr: String) -> String? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, attr as CFString, &value) == .success else { return nil }
    return value as? String
}

func axElement(_ element: AXUIElement, _ attr: String) -> AXUIElement? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, attr as CFString, &value) == .success, let v = value else { return nil }
    return (v as! AXUIElement)
}

func axRange(_ element: AXUIElement, _ attr: String) -> CFRange? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, attr as CFString, &value) == .success, let v = value else { return nil }
    var range = CFRange()
    guard AXValueGetType(v as! AXValue) == .cfRange, AXValueGetValue(v as! AXValue, .cfRange, &range) else { return nil }
    return range
}

func axBool(_ element: AXUIElement, _ attr: String) -> Bool? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, attr as CFString, &value) == .success else { return nil }
    return value as? Bool
}

func jsonEscape(_ s: String) -> String {
    var out = ""
    for ch in s.unicodeScalars {
        switch ch {
        case "\"": out += "\\\""
        case "\\": out += "\\\\"
        case "\n": out += "\\n"
        case "\r": out += "\\r"
        case "\t": out += "\\t"
        case "\0": break
        default:
            if ch.value < 0x20 { out += String(format: "\\u%04x", ch.value) } else { out.unicodeScalars.append(ch) }
        }
    }
    return out
}

var fields: [String: Any] = ["helper": true]

if let app = NSWorkspace.shared.frontmostApplication {
    fields["appName"] = app.localizedName ?? ""
    fields["bundleId"] = app.bundleIdentifier ?? ""
    let appElement = AXUIElementCreateApplication(app.processIdentifier)
    AXUIElementSetMessagingTimeout(appElement, 0.25)
    if let window = axElement(appElement, kAXFocusedWindowAttribute as String) {
        fields["windowTitle"] = axString(window, kAXTitleAttribute as String) ?? ""
    }
    if let focused = axElement(appElement, kAXFocusedUIElementAttribute as String) {
        let role = axString(focused, kAXRoleAttribute as String) ?? ""
        fields["role"] = role
        let textRoles: Set<String> = ["AXTextField", "AXTextArea", "AXComboBox", "AXSearchField", "AXWebArea"]
        let editable = textRoles.contains(role) || (axBool(focused, "AXEditable") ?? false)
        fields["isEditable"] = editable
        if let value = axString(focused, kAXValueAttribute as String) {
            let chars = Array(value.utf16)
            let maxSide = 2000
            if let sel = axRange(focused, kAXSelectedTextRangeAttribute as String),
               sel.location >= 0, sel.location + sel.length <= chars.count {
                let before = chars[max(0, sel.location - maxSide)..<sel.location]
                let selected = chars[sel.location..<(sel.location + sel.length)]
                let after = chars[(sel.location + sel.length)..<min(chars.count, sel.location + sel.length + maxSide)]
                fields["beforeText"] = String(utf16CodeUnits: Array(before), count: before.count)
                fields["selectedText"] = String(utf16CodeUnits: Array(selected), count: selected.count)
                fields["afterText"] = String(utf16CodeUnits: Array(after), count: after.count)
            } else {
                fields["beforeText"] = String(value.suffix(maxSide))
                fields["afterText"] = ""
            }
        }
    }
} else {
    fields["error"] = "no frontmost application"
}

var parts: [String] = []
for (k, v) in fields {
    if let s = v as? String { parts.append("\"\(k)\":\"\(jsonEscape(s))\"") }
    else if let b = v as? Bool { parts.append("\"\(k)\":\(b)") }
}
print("{" + parts.joined(separator: ",") + "}")
