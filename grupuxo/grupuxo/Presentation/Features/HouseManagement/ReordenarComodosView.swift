//
//  ReordenarComodosView.swift
//  grupuxo
//
//  Created by Giovanna Spigariol on 13/10/26.
//

import Foundation
import SwiftUI

// MARK: - Modelo

struct RoomItem: Identifiable {
    let id: UUID
    var name: String
    var symbol: String
    var color: Color
    var isPrivate: Bool = false
}

// MARK: - Tela

struct ReordenarComodosView: View {

    @Environment(\.dismiss) private var dismiss

    private let original: [RoomItem]
    private let onSave: ([RoomItem]) -> Void

    @State private var rooms: [RoomItem]
    @State private var showDiscard = false

    init(
        rooms: [RoomItem],
        onSave: @escaping ([RoomItem]) -> Void
    ) {
        self.original = rooms
        self.onSave = onSave
        _rooms = State(initialValue: rooms)
    }

    /// O alerta de descartar só existe se a ordem mudou.
    private var isDirty: Bool {
        rooms.map(\.id) != original.map(\.id)
    }

    var body: some View {

        NavigationStack {

            List {

                Section {

                    ForEach(rooms) { room in
                        ReorderRoomRow(room: room)
                    }
                    .onMove { source, destination in
                        Haptics.selection()
                        rooms.move(
                            fromOffsets: source,
                            toOffset: destination
                        )
                    }

                } footer: {

                    Text(
                        "Arraste para mudar a ordem em que os cômodos aparecem na aba Casa."
                    )
                }
            }

            // Mantém as alças de arrastar sempre visíveis,
            // como no "Editar Lista" do Lembretes.
            .environment(
                \.editMode,
                .constant(.active)
            )
            .navigationTitle("Reordenar")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                toolbarContent
            }
            .interactiveDismissDisabled(isDirty)
        }
    }

    // MARK: - Toolbar

    @ToolbarContentBuilder
    private var toolbarContent: some ToolbarContent {

        ToolbarItem(
            placement: .cancellationAction
        ) {

            Button {

                if isDirty {
                    showDiscard = true
                } else {
                    dismiss()
                }

            } label: {

                Image(systemName: "xmark")
            }
            .accessibilityLabel("Fechar")
            .confirmationDialog(
                "Descartar alterações?",
                isPresented: $showDiscard,
                titleVisibility: .visible
            ) {

                Button(
                    "Descartar",
                    role: .destructive
                ) {
                    dismiss()
                }

            } message: {

                Text(
                    "Ao descartar, a ordem dos cômodos continua como estava."
                )
            }
        }

        ToolbarItem(
            placement: .confirmationAction
        ) {

            Button {

                if isDirty {
                    onSave(rooms)
                }

                dismiss()

            } label: {

                Image(systemName: "checkmark")
            }
            .accessibilityLabel("Salvar ordem")
        }
    }
}

// MARK: - Linha

private struct ReorderRoomRow: View {

    let room: RoomItem

    var body: some View {

        HStack(spacing: 12) {

            Image(systemName: room.symbol)
                .font(.body)
                .foregroundStyle(.white)
                .frame(
                    width: 34,
                    height: 34
                )
                .background(
                    room.color.gradient,
                    in: Circle()
                )

            Text(room.name)

            if room.isPrivate {

                Image(systemName: "lock.fill")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
        .accessibilityElement(
            children: .combine
        )
        .accessibilityLabel(
            room.isPrivate
                ? String(localized: "\(room.name), cômodo privado")
                : room.name
        )
    }
}

// MARK: - Preview

#Preview {

    ReordenarComodosView(
        rooms: [
            RoomItem(
                id: UUID(),
                name: "Banheiro",
                symbol: "toilet.fill",
                color: .cyan
            ),
            RoomItem(
                id: UUID(),
                name: "Cozinha",
                symbol: "cup.and.saucer.fill",
                color: .orange
            ),
            RoomItem(
                id: UUID(),
                name: "Sala de Estar",
                symbol: "sofa.fill",
                color: .brown
            ),
            RoomItem(
                id: UUID(),
                name: "Quarto 1",
                symbol: "bed.double.fill",
                color: .indigo,
                isPrivate: true
            ),
            RoomItem(
                id: UUID(),
                name: "Garagem",
                symbol: "car.fill",
                color: .gray
            )
        ],
        onSave: { _ in }
    )
}
