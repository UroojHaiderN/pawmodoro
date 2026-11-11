// Pawmodoro for Mac.
// Wraps the Pawmodoro web app (index.html + app.js, bundled in Resources/web) in a borderless,
// see-through panel that floats above every app, with a paw icon in the menu bar to show or hide it.
import Cocoa
import WebKit

let webScheme = "pawmodoro"

/// A panel that can take keyboard input (for typing tasks) without pulling focus away from your other app.
final class FloatingPanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
}

final class PawWebView: WKWebView {
    // Let the first click land on a button even when another app is active.
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
}

/// Serves the bundled web files at pawmodoro://app/… so the page gets a stable origin (and keeps its saved tasks).
final class BundleSchemeHandler: NSObject, WKURLSchemeHandler {
    private let root: URL
    init(root: URL) { self.root = root.standardizedFileURL }

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url else { return }
        var path = url.path
        if path.isEmpty || path == "/" { path = "/index.html" }
        let file = root.appendingPathComponent(String(path.dropFirst())).standardizedFileURL
        guard file.path.hasPrefix(root.path + "/"), let data = try? Data(contentsOf: file) else {
            task.didFailWithError(NSError(domain: NSURLErrorDomain, code: NSURLErrorFileDoesNotExist))
            return
        }
        let headers = ["Content-Type": Self.mime(file.pathExtension), "Content-Length": String(data.count), "Cache-Control": "no-cache"]
        let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: headers)!
        task.didReceive(response)
        task.didReceive(data)
        task.didFinish()
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}

    static func mime(_ ext: String) -> String {
        switch ext.lowercased() {
        case "html": return "text/html; charset=utf-8"
        case "js": return "text/javascript; charset=utf-8"
        case "css": return "text/css; charset=utf-8"
        case "svg": return "image/svg+xml"
        case "png": return "image/png"
        case "json", "webmanifest": return "application/json"
        default: return "application/octet-stream"
        }
    }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, WKScriptMessageHandler, WKNavigationDelegate {
    private var panel: FloatingPanel!
    private var webView: PawWebView!
    private var glassView: NSVisualEffectView! // real frosted glass behind the card in the Glass colors
    private var statusItem: NSStatusItem!
    private var dragRects: [NSRect] = []
    private var selftestDir: String?
    private let positionKey = "PanelTopLeft"

    func applicationDidFinishLaunching(_ notification: Notification) {
        let args = CommandLine.arguments
        if let i = args.firstIndex(of: "--selftest"), i + 1 < args.count { selftestDir = args[i + 1] }
        buildMainMenu()
        buildPanel()
        buildStatusItem()
        installDragMonitor()
        panel.orderFrontRegardless()
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        panel.orderFrontRegardless()
        return true
    }

    // MARK: Window

    private func buildPanel() {
        let root = Bundle.main.resourceURL!.appendingPathComponent("web")
        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(BundleSchemeHandler(root: root), forURLScheme: webScheme)
        let content = WKUserContentController()
        content.add(self, name: "pawmodoro")
        content.addUserScript(WKUserScript(source: "document.documentElement.classList.add('in-app');",
                                           injectionTime: .atDocumentStart, forMainFrameOnly: true))
        config.userContentController = content
        config.mediaTypesRequiringUserActionForPlayback = []
        if #available(macOS 14.0, *) { config.preferences.inactiveSchedulingPolicy = .none } // keep the timer ticking when hidden

        let size = NSSize(width: 340, height: 640)
        webView = PawWebView(frame: NSRect(origin: .zero, size: size), configuration: config)
        webView.setValue(false, forKey: "drawsBackground")
        webView.navigationDelegate = self
        webView.autoresizingMask = [.width, .height]
        if #available(macOS 13.3, *) { webView.isInspectable = true }

        panel = FloatingPanel(contentRect: NSRect(origin: .zero, size: size),
                              styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false // the card draws its own soft shadow
        panel.level = .floating
        panel.isFloatingPanel = true
        panel.hidesOnDeactivate = false
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .ignoresCycle]

        // The blur sits underneath the see-through page and only shows in the Glass colors.
        let container = NSView(frame: NSRect(origin: .zero, size: size))
        glassView = NSVisualEffectView(frame: .zero)
        glassView.material = .hudWindow
        glassView.blendingMode = .behindWindow
        glassView.state = .active // stay frosted even though another app is in front
        glassView.isHidden = true
        container.addSubview(glassView)
        webView.frame = container.bounds
        container.addSubview(webView)
        panel.contentView = container
        panel.setFrameTopLeftPoint(savedTopLeft() ?? defaultTopLeft(for: size))
        panel.delegate = self

        webView.load(URLRequest(url: URL(string: "\(webScheme)://app/index.html")!))
    }

    private func defaultTopLeft(for size: NSSize) -> NSPoint {
        let frame = (NSScreen.main ?? NSScreen.screens[0]).visibleFrame
        return NSPoint(x: frame.maxX - size.width - 12, y: frame.maxY - 4)
    }

    private func savedTopLeft() -> NSPoint? {
        guard let a = UserDefaults.standard.array(forKey: positionKey) as? [Double], a.count == 2 else { return nil }
        let p = NSPoint(x: a[0], y: a[1])
        return NSScreen.screens.contains { $0.visibleFrame.insetBy(dx: -40, dy: -40).contains(p) } ? p : nil
    }

    func windowDidMove(_ notification: Notification) {
        UserDefaults.standard.set([Double(panel.frame.minX), Double(panel.frame.maxY)], forKey: positionKey)
    }

    /// Clicks on the cat, the tape or the clock drag the whole window, like the title bar of a normal window.
    private func installDragMonitor() {
        NSEvent.addLocalMonitorForEvents(matching: .leftMouseDown) { [weak self] event in
            guard let self, event.window === self.panel else { return event }
            let p = self.webView.convert(event.locationInWindow, from: nil)
            let point = NSPoint(x: p.x, y: self.webView.isFlipped ? p.y : self.webView.bounds.height - p.y)
            if self.dragRects.contains(where: { $0.contains(point) }) {
                self.panel.performDrag(with: event)
                return nil
            }
            return event
        }
    }

    // MARK: Menu bar paw

    private func buildStatusItem() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        guard let button = statusItem.button else { return }
        button.image = Self.pawImage()
        button.imagePosition = .imageLeading
        button.font = NSFont.monospacedDigitSystemFont(ofSize: 12, weight: .medium)
        button.toolTip = "Pawmodoro"
        button.target = self
        button.action = #selector(statusClicked(_:))
        button.sendAction(on: [.leftMouseUp, .rightMouseUp])
    }

    @objc private func statusClicked(_ sender: Any?) {
        let event = NSApp.currentEvent
        if event?.type == .rightMouseUp || event?.modifierFlags.contains(.control) == true {
            showStatusMenu()
        } else {
            togglePanel()
        }
    }

    private func showStatusMenu() {
        let menu = NSMenu()
        let toggle = menu.addItem(withTitle: panel.isVisible ? "Hide Pawmodoro" : "Show Pawmodoro",
                                  action: #selector(togglePanel), keyEquivalent: "")
        toggle.target = self
        let startPause = menu.addItem(withTitle: "Start or Pause", action: #selector(startOrPause), keyEquivalent: "")
        startPause.target = self
        menu.addItem(.separator())
        menu.addItem(withTitle: "Quit Pawmodoro", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        statusItem.menu = menu
        statusItem.button?.performClick(nil)
        statusItem.menu = nil
    }

    @objc private func togglePanel() {
        if panel.isVisible { panel.orderOut(nil) } else { panel.orderFrontRegardless() }
    }

    @objc private func startOrPause() {
        webView.evaluateJavaScript("document.querySelector('#go').click(); 1", completionHandler: nil)
    }

    static func pawImage() -> NSImage {
        let image = NSImage(size: NSSize(width: 18, height: 18), flipped: true) { _ in
            NSColor.black.setFill()
            NSBezierPath(ovalIn: NSRect(x: 4.95, y: 8.55, width: 8.1, height: 6.9)).fill()
            for (x, y, r) in [(3.9, 7.65, 1.8), (6.9, 4.5, 1.88), (11.1, 4.5, 1.88), (14.1, 7.65, 1.8)] {
                NSBezierPath(ovalIn: NSRect(x: x - r, y: y - r, width: r * 2, height: r * 2)).fill()
            }
            return true
        }
        image.isTemplate = true
        return image
    }

    /// The card's shape: a rectangle whose four corners each have their own horizontal and vertical radius,
    /// like the CSS border-radius on the card (radii in order top-left, top-right, bottom-right, bottom-left).
    static func cardMask(size: NSSize, radii: [[CGFloat]]) -> NSImage {
        NSImage(size: size, flipped: true) { rect in
            func corner(_ i: Int) -> (CGFloat, CGFloat) {
                i < radii.count && radii[i].count == 2 ? (radii[i][0], radii[i][1]) : (24, 24)
            }
            let (tlX, tlY) = corner(0), (trX, trY) = corner(1), (brX, brY) = corner(2), (blX, blY) = corner(3)
            let w = rect.width, h = rect.height, k: CGFloat = 0.4477 // 1 - 0.5523, the usual Bézier circle factor
            let path = NSBezierPath()
            path.move(to: NSPoint(x: tlX, y: 0))
            path.line(to: NSPoint(x: w - trX, y: 0))
            path.curve(to: NSPoint(x: w, y: trY), controlPoint1: NSPoint(x: w - trX * k, y: 0), controlPoint2: NSPoint(x: w, y: trY * k))
            path.line(to: NSPoint(x: w, y: h - brY))
            path.curve(to: NSPoint(x: w - brX, y: h), controlPoint1: NSPoint(x: w, y: h - brY * k), controlPoint2: NSPoint(x: w - brX * k, y: h))
            path.line(to: NSPoint(x: blX, y: h))
            path.curve(to: NSPoint(x: 0, y: h - blY), controlPoint1: NSPoint(x: blX * k, y: h), controlPoint2: NSPoint(x: 0, y: h - blY * k))
            path.line(to: NSPoint(x: 0, y: tlY))
            path.curve(to: NSPoint(x: tlX, y: 0), controlPoint1: NSPoint(x: 0, y: tlY * k), controlPoint2: NSPoint(x: tlX * k, y: 0))
            path.close()
            NSColor.black.setFill()
            path.fill()
            return true
        }
    }

    /// Without a main menu, copy and paste would not work while typing a task.
    private func buildMainMenu() {
        let main = NSMenu()
        let appItem = NSMenuItem()
        main.addItem(appItem)
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "Quit Pawmodoro", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu
        let editItem = NSMenuItem()
        main.addItem(editItem)
        let edit = NSMenu(title: "Edit")
        edit.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
        edit.addItem(withTitle: "Redo", action: Selector(("redo:")), keyEquivalent: "Z")
        edit.addItem(.separator())
        edit.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        edit.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        edit.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        edit.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editItem.submenu = edit
        NSApp.mainMenu = main
    }

    // MARK: Messages from the page

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
        func num(_ d: [String: Any], _ key: String) -> CGFloat { CGFloat((d[key] as? NSNumber)?.doubleValue ?? 0) }
        switch type {
        case "size": // keep the window hugging the card, anchored at its top edge
            let w = num(body, "w"), h = num(body, "h")
            guard w > 40, h > 40 else { return }
            var frame = panel.frame
            let top = frame.maxY
            frame.size = NSSize(width: w, height: h)
            frame.origin.y = top - h
            panel.setFrame(frame, display: true)
        case "drag":
            let rects = body["rects"] as? [[String: Any]] ?? []
            dragRects = rects.map { NSRect(x: num($0, "x"), y: num($0, "y"), width: num($0, "w"), height: num($0, "h")) }
        case "tick": // show the countdown next to the paw while a timer runs
            let running = (body["running"] as? Bool) ?? false
            statusItem.button?.title = running ? " " + ((body["text"] as? String) ?? "") : ""
        case "glass": // frosted glass cut to the card's exact rounded shape
            let on = (body["on"] as? Bool) ?? false
            glassView.isHidden = !on
            guard on, let r = body["rect"] as? [String: Any], let host = glassView.superview else { return }
            let rect = NSRect(x: num(r, "x"), y: num(r, "y"), width: num(r, "w"), height: num(r, "h"))
            guard rect.width > 0, rect.height > 0 else { glassView.isHidden = true; return }
            let radii = (body["radii"] as? [[NSNumber]] ?? []).map { $0.map { CGFloat($0.doubleValue) } }
            glassView.frame = NSRect(x: rect.minX, y: host.bounds.height - rect.maxY, width: rect.width, height: rect.height)
            glassView.maskImage = Self.cardMask(size: rect.size, radii: radii)
        case "hide":
            panel.orderOut(nil)
        default:
            break
        }
    }

    // MARK: Self-test (run the binary with --selftest <folder> to save snapshots and print checks)

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard let dir = selftestDir else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) { self.runSelftest(dir) }
    }

    private func log(_ text: String) { FileHandle.standardError.write(Data((text + "\n").utf8)) }

    private func snapshot(_ name: String, _ dir: String, then next: @escaping () -> Void) {
        webView.takeSnapshot(with: nil) { image, _ in
            if let image, let tiff = image.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff),
               let png = rep.representation(using: .png, properties: [:]) {
                try? png.write(to: URL(fileURLWithPath: dir).appendingPathComponent(name))
            }
            next()
        }
    }

    /// Switches to the Glass colors, records where the frosted layer landed, then puts the old colors back.
    private func checkGlass(_ dir: String) {
        let pickGlass = "window.__lookBefore = (document.querySelector('.sw[aria-checked=true]') || { dataset: { look: 'auto' } }).dataset.look; document.querySelector('[data-look=glass]').click(); 1"
        webView.evaluateJavaScript(pickGlass) { _, _ in
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
                self.log("GLASS shown=\(!self.glassView.isHidden) frame=\(self.glassView.frame) mask=\(self.glassView.maskImage?.size ?? .zero) panel=\(self.panel.frame.size)")
                self.snapshot("glass.png", dir) {
                    self.webView.evaluateJavaScript("document.querySelector('[data-look=' + window.__lookBefore + ']').click(); 1") { _, _ in
                        DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) {
                            self.log("AFTER glassShown=\(!self.glassView.isHidden)")
                            NSApp.terminate(nil)
                        }
                    }
                }
            }
        }
    }

    private func runSelftest(_ dir: String) {
        let js = """
        (() => {
          const before = localStorage.getItem('pawmodoro-selftest');
          localStorage.setItem('pawmodoro-selftest', String(Date.now()));
          const r = document.querySelector('.stage').getBoundingClientRect();
          return JSON.stringify({
            inApp: document.documentElement.classList.contains('in-app'),
            savedFromLastRun: before !== null,
            stage: [Math.round(r.width), Math.round(r.height)],
            handFont: document.fonts.check('16px Gaegu'),
            floatHidden: document.querySelector('#float-btn').hidden,
            hideShown: !document.querySelector('#hide-btn').hidden
          });
        })()
        """
        webView.evaluateJavaScript(js) { result, error in
            self.log("SELFTEST \(result ?? "nil") \(error?.localizedDescription ?? "")")
            self.log("PANEL \(self.panel.frame) dragAreas=\(self.dragRects.count) menuTitle='\(self.statusItem.button?.title ?? "")'")
            self.snapshot("full.png", dir) {
                self.webView.evaluateJavaScript("document.querySelector('#mini-btn').click(); 1") { _, _ in
                    DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
                        self.log("PANEL-MINI \(self.panel.frame) dragAreas=\(self.dragRects.count)")
                        self.snapshot("mini.png", dir) {
                            self.webView.evaluateJavaScript("document.querySelector('#mini-expand').click(); 1") { _, _ in
                                self.checkGlass(dir)
                            }
                        }
                    }
                }
            }
        }
    }
}

@main
struct PawmodoroMain {
    @MainActor static func main() {
        let app = NSApplication.shared
        let delegate = AppDelegate()
        app.delegate = delegate
        app.setActivationPolicy(.accessory) // menu bar app: no Dock icon
        withExtendedLifetime(delegate) { app.run() }
    }
}
