import AppKit
import AVFoundation

final class Recorder: NSObject, NSApplicationDelegate, AVAudioRecorderDelegate {
    let directory: URL
    let limit: Double
    let toggleURL: URL?
    let cancelURL: URL?
    var recorder: AVAudioRecorder?
    var timer: Timer?
    var statusItem: NSStatusItem?
    var panel: NSPanel?
    var label: NSTextField?
    var ended = false
    var startedAt: Date?

    init(arguments: [String]) {
        directory = URL(fileURLWithPath: arguments[1], isDirectory: true)
        limit = min(300, max(5, Double(arguments[2]) ?? 300))
        toggleURL = arguments.count > 3 ? URL(string: arguments[3]) : nil
        cancelURL = arguments.count > 4 ? URL(string: arguments[4]) : nil
    }
    func has(_ name: String) -> Bool {
        FileManager.default.fileExists(atPath: directory.appendingPathComponent(name).path)
    }
    func state(_ status: String, error: String? = nil) {
        var value: [String: Any] = ["status": status, "pid": ProcessInfo.processInfo.processIdentifier]
        if let startedAt { value["duration"] = Date().timeIntervalSince(startedAt) }
        if let error { value["error"] = error }
        do {
            let data = try JSONSerialization.data(withJSONObject: value)
            let url = directory.appendingPathComponent("recorder.json")
            try data.write(to: url, options: .atomic)
            try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
        } catch { NSApplication.shared.terminate(nil) }
    }
    func applicationDidFinishLaunching(_ notification: Notification) {
        state("starting")
        if has("cancel") { end(cancelled: true); return }
        if has("stop") { end(); return }
        // Poll cancellation even while the first microphone prompt is open.
        timer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in self?.tick() }
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized: begin()
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .audio) { [weak self] allowed in
                DispatchQueue.main.async {
                    guard let self, !self.ended else { return }
                    if allowed { self.begin() } else { self.fail("Microphone permission denied. Allow Gemini Recorder in System Settings → Privacy & Security → Microphone.") }
                }
            }
        default: fail("Microphone permission denied. Allow Gemini Recorder in System Settings → Privacy & Security → Microphone.")
        }
    }
    func begin() {
        guard !ended else { return }
        if has("cancel") { end(cancelled: true); return }
        if has("stop") { end(); return }
        do {
            recorder = try AVAudioRecorder(url: directory.appendingPathComponent("audio.wav"), settings: [
                AVFormatIDKey: kAudioFormatLinearPCM,
                AVSampleRateKey: 16000,
                AVNumberOfChannelsKey: 1,
                AVLinearPCMBitDepthKey: 16,
                AVLinearPCMIsFloatKey: false,
                AVLinearPCMIsBigEndianKey: false
            ])
            recorder?.delegate = self
            guard recorder?.prepareToRecord() == true, recorder?.record() == true else {
                fail("The microphone could not start. Check the selected input device in Sound settings."); return
            }
            try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: directory.appendingPathComponent("audio.wav").path)
            startedAt = Date()
            showIndicator()
            state("recording")
        } catch { fail("Audio recorder failed: \(error.localizedDescription)") }
    }
    func showIndicator() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        statusItem?.button?.title = "● Mic"
        let menu = NSMenu()
        let stop = NSMenuItem(title: "Stop and Transcribe", action: #selector(finishFromMenu), keyEquivalent: "")
        stop.target = self; menu.addItem(stop)
        let cancel = NSMenuItem(title: "Cancel Recording", action: #selector(cancelFromMenu), keyEquivalent: "")
        cancel.target = self; menu.addItem(cancel)
        statusItem?.menu = menu
        let frame = NSRect(x: 0, y: 0, width: 340, height: 54)
        let p = NSPanel(contentRect: frame, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        p.level = .floating; p.isOpaque = false; p.backgroundColor = .clear
        p.hasShadow = true; p.ignoresMouseEvents = true
        p.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        let effect = NSVisualEffectView(frame: frame)
        effect.material = .hudWindow; effect.state = .active; effect.wantsLayer = true
        effect.layer?.cornerRadius = 16
        effect.layer?.masksToBounds = true
        // The material has its own backdrop surface. A layer corner radius
        // alone does not clip it, so mask the material and its window shadow.
        let mask = NSImage(size: NSSize(width: 34, height: 34), flipped: false) { rect in
            NSColor.black.setFill()
            NSBezierPath(roundedRect: rect, xRadius: 16, yRadius: 16).fill()
            return true
        }
        mask.capInsets = NSEdgeInsets(top: 16, left: 16, bottom: 16, right: 16)
        mask.resizingMode = .stretch
        effect.maskImage = mask
        let l = NSTextField(labelWithString: "● Recording 0:00 · press hotkey to finish")
        l.font = .systemFont(ofSize: 13, weight: .medium)
        l.textColor = .labelColor; l.alignment = .center
        l.frame = NSRect(x: 8, y: 18, width: 324, height: 18)
        effect.addSubview(l); p.contentView = effect
        if let screen = NSScreen.main {
            let visible = screen.visibleFrame
            p.setFrameOrigin(NSPoint(x: visible.midX - 170, y: visible.minY + 26))
        }
        p.orderFrontRegardless(); panel = p; label = l
    }
    @objc func finishFromMenu() {
        end(launch: toggleURL)
    }
    @objc func cancelFromMenu() {
        end(cancelled: true, launch: cancelURL)
    }
    func tick() {
        guard !ended else { return }
        if has("cancel") { end(cancelled: true); return }
        if has("stop") { end(); return }
        guard let startedAt else { return }
        let elapsed = Date().timeIntervalSince(startedAt)
        let secs = Int(elapsed)
        label?.stringValue = String(format: "● Recording %d:%02d · press hotkey to finish", secs / 60, secs % 60)
        if elapsed >= limit { end() }
    }
    func end(cancelled: Bool = false, launch: URL? = nil) {
        guard !ended else { return }
        ended = true; timer?.invalidate(); recorder?.stop()
        panel?.orderOut(nil)
        if let statusItem { NSStatusBar.system.removeStatusItem(statusItem) }
        // AVAudioRecorder.stop() finalizes the WAV before publishing stopped.
        state(cancelled ? "cancelled" : "stopped")
        if let launch { NSWorkspace.shared.open(launch) }
        NSApplication.shared.terminate(nil)
    }
    func fail(_ message: String) {
        guard !ended else { return }
        ended = true; recorder?.stop(); state("error", error: message)
        NSApplication.shared.terminate(nil)
    }
    func audioRecorderEncodeErrorDidOccur(_ recorder: AVAudioRecorder, error: Error?) {
        fail("Audio recording failed: \(error?.localizedDescription ?? "unknown error")")
    }
    func audioRecorderDidFinishRecording(_ recorder: AVAudioRecorder, successfully flag: Bool) {
        if !ended { fail(flag ? "The input device stopped unexpectedly." : "The audio device was interrupted.") }
    }
    func applicationWillTerminate(_ notification: Notification) {
        if !ended { ended = true; recorder?.stop(); state("stopped") }
    }
}

let args = CommandLine.arguments
if args.count == 2, args[1] == "--preview-indicator" {
    // Visual QA without requesting microphone permission or recording audio.
    let app = NSApplication.shared
    app.setActivationPolicy(.accessory)
    let preview = Recorder(arguments: [args[0], NSTemporaryDirectory() + UUID().uuidString, "30"])
    preview.showIndicator()
    Timer.scheduledTimer(withTimeInterval: 45, repeats: false) { _ in app.terminate(nil) }
    withExtendedLifetime(preview) { app.run() }
    exit(0)
}
if args.count == 3, args[1] == "--inspect-audio" {
    do {
        let file = try AVAudioFile(forReading: URL(fileURLWithPath: args[2]))
        print("frames=\(file.length) sampleRate=\(file.fileFormat.sampleRate) channels=\(file.fileFormat.channelCount)")
        exit(file.length > 0 ? 0 : 1)
    } catch { fputs("\(error.localizedDescription)\n", stderr); exit(1) }
}
guard args.count >= 3 else { fputs("Usage: GeminiRecorder SESSION_DIRECTORY MAX_SECONDS [TOGGLE_URL CANCEL_URL]\n", stderr); exit(2) }
let application = NSApplication.shared
application.setActivationPolicy(.accessory)
let delegate = Recorder(arguments: args)
application.delegate = delegate
application.run()
