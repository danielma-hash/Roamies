import Foundation
import AVFoundation

// Native audio capture stays here; the Soniox protocol and credentials live in the TypeScript helper.
final class SonioxRecognizer: Recognizer {
    private let process = Process()
    private let input = Pipe(), output = Pipe()
    private let queue = DispatchQueue(label: "roamies.soniox")
    private var callbacks: RecognizerCallbacks?
    private var configured = false
    private var stopped = false
    private var pending = Data()

    init(_ callbacks: RecognizerCallbacks) {
        self.callbacks = callbacks
        let env = ProcessInfo.processInfo.environment
        process.executableURL = URL(fileURLWithPath: env["ROAMIES_NODE"] ?? "/usr/local/bin/node")
        process.arguments = [env["ROAMIES_STT"] ?? ""]
        process.standardInput = input
        process.standardOutput = output
        process.standardError = FileHandle.standardError
        output.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let bytes = handle.availableData
            if bytes.isEmpty {
                handle.readabilityHandler = nil
                self?.queue.async { [weak self] in
                    DispatchQueue.main.async { [weak self] in
                        guard let self, !self.stopped else { return }
                        self.stopped = true
                        let callback = self.callbacks
                        self.callbacks = nil
                        callback?.onError(NSError(domain: "Soniox", code: 2, userInfo: [NSLocalizedDescriptionKey: "Soniox speech helper stopped unexpectedly"]))
                        self.close()
                    }
                }
                return
            }
            self?.queue.async { [weak self] in
                guard let self else { return }
                self.pending.append(bytes)
                while let end = self.pending.firstIndex(of: 10) {
                    let line = self.pending.prefix(upTo: end)
                    self.pending.removeSubrange(...end)
                    guard let msg = (try? JSONSerialization.jsonObject(with: line)) as? [String: Any] else { continue }
                    DispatchQueue.main.async { [weak self] in
                        guard let self, !self.stopped else { return }
                        if let text = msg["text"] as? String { self.callbacks?.onText(text) }
                        if msg["done"] as? Bool == true {
                            self.stopped = true
                            let callback = self.callbacks
                            self.callbacks = nil
                            callback?.onDone()
                            self.close()
                        }
                        if let error = msg["error"] as? String {
                            self.stopped = true
                            let callback = self.callbacks
                            self.callbacks = nil
                            callback?.onError(NSError(domain: "Soniox", code: 1, userInfo: [NSLocalizedDescriptionKey: error]))
                            self.close()
                        }
                    }
                }
            }
        }
        do { try process.run() }
        catch { DispatchQueue.main.async { callbacks.onError(error) } }
    }

    func append(_ buffer: AVAudioPCMBuffer) {
        guard let samples = buffer.floatChannelData?[0] else { return }
        var pcm = Data(capacity: Int(buffer.frameLength) * 2)
        for i in 0 ..< Int(buffer.frameLength) {
            var sample = Int16(max(-32768, min(32767, (samples[i] * 32767).rounded()))).littleEndian
            withUnsafeBytes(of: &sample) { pcm.append(contentsOf: $0) }
        }
        let rate = Int(buffer.format.sampleRate)
        queue.async { [weak self] in
            guard let self else { return }
            if !self.configured { self.send(["rate": rate]); self.configured = true }
            self.send(["pcm": pcm.base64EncodedString()])
        }
    }
    func end() { queue.async { [weak self] in self?.send(["end": true]) } }
    func cancel() { stopped = true; callbacks = nil; close() }
    private func close() {
        output.fileHandleForReading.readabilityHandler = nil
        queue.async { [self] in
            try? input.fileHandleForWriting.close()
            if process.isRunning { process.terminate() }
        }
    }
    private func send(_ message: [String: Any]) {
        guard process.isRunning, var data = try? JSONSerialization.data(withJSONObject: message) else { return }
        data.append(10)
        try? input.fileHandleForWriting.write(contentsOf: data)
    }
}
