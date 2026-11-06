import SwiftUI

/// Seção de formulário com um nome editável (morador em Conta, casa em Casa). Salva ao tocar em "Salvar" ou no
/// "OK" do teclado; se o servidor recusar, volta ao nome salvo. O nome vazio nem chega ao servidor.
struct EditableNameSection: View {

    let header: LocalizedStringKey
    let placeholder: LocalizedStringKey
    let currentName: String
    /// Texto do erro quando o campo fica vazio.
    let emptyMessage: String
    let save: (String) async -> Bool

    @State private var draft = ""
    @State private var isSaving = false
    @State private var errorMessage: String?
    @FocusState private var isFocused: Bool

    private var trimmed: String { draft.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var isDirty: Bool { trimmed != currentName }

    var body: some View {

        Section {
            TextField(placeholder, text: $draft)
                .focused($isFocused)
                .submitLabel(.done)
                .onSubmit { Task { await commit() } }
                .disabled(isSaving)

            if isDirty {
                Button("Salvar") { Task { await commit() } }
                    .disabled(isSaving)
            }
        } header: {
            Text(header).formSectionHeader()
        } footer: {
            if let errorMessage {
                Text(errorMessage).foregroundStyle(.red)
            }
        }
        .onAppear { draft = currentName }
        .onChange(of: currentName) { _, name in
            if !isFocused { draft = name }
        }
    }

    private func commit() async {
        guard isDirty, !isSaving else { return }
        guard !trimmed.isEmpty else {
            errorMessage = emptyMessage
            return
        }
        errorMessage = nil
        isSaving = true
        defer { isSaving = false }
        if await save(trimmed) {
            isFocused = false
            draft = trimmed
        } else {
            draft = currentName
        }
    }
}
