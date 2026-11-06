import GrupuxoDomain
import PhotosUI
import SwiftUI
import UIKit

/// Prepara a foto do perfil: recorta em quadrado, reduz para 512 px e gera JPEG (o servidor aceita só JPEG).
enum ProfilePhoto {

    static let side: CGFloat = 512
    static let quality: CGFloat = 0.8

    static func jpegData(from data: Data) -> Data? {
        guard let image = UIImage(data: data) else { return nil }
        let edge = min(image.size.width, image.size.height)
        guard edge > 0 else { return nil }
        let target = min(edge, side)
        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1
        let renderer = UIGraphicsImageRenderer(size: CGSize(width: target, height: target), format: format)
        let scale = target / edge
        let rendered = renderer.image { _ in
            let size = CGSize(width: image.size.width * scale, height: image.size.height * scale)
            image.draw(in: CGRect(
                x: (target - size.width) / 2, y: (target - size.height) / 2, width: size.width, height: size.height
            ))
        }
        return rendered.jpegData(compressionQuality: quality)
    }
}

/// "Adicionar foto" / "Trocar foto" / "Remover foto" na tela Conta.
struct ProfilePhotoSection: View {

    @EnvironmentObject private var houses: RemoteHouseSession
    @State private var selection: PhotosPickerItem?
    @State private var isSaving = false

    var body: some View {

        Section {
            PhotosPicker(selection: $selection, matching: .images) {
                Label(hasPhoto ? "Trocar foto" : "Adicionar foto", systemImage: "camera")
            }
            .disabled(isSaving)
            .accessibilityIdentifier("pickPhoto")

            if hasPhoto {
                Button("Remover foto", role: .destructive) {
                    Task { await save(nil) }
                }
                .disabled(isSaving)
            }
        } footer: {
            Text("Seu nome e sua foto aparecem nas tarefas e no rodízio.")
        }
        .onChange(of: selection) { _, item in
            guard let item else { return }
            Task {
                defer { selection = nil }
                guard let data = try? await item.loadTransferable(type: Data.self),
                      let jpeg = ProfilePhoto.jpegData(from: data) else {
                    houses.errorMessage = String(localized: "Não foi possível usar essa foto.")
                    return
                }
                await save(jpeg)
            }
        }
    }

    private var hasPhoto: Bool { houses.me?.photoURL != nil }

    private func save(_ jpeg: Data?) async {
        isSaving = true
        defer { isSaving = false }
        _ = await houses.updatePhoto(jpeg: jpeg)
    }
}
