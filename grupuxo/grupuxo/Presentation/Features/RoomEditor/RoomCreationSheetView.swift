import SwiftUI

struct RoomCreationSheetView: View {
    @Environment(\.dismiss) private var dismiss
    @FocusState private var isNameFocused: Bool
    @StateObject private var viewModel: RoomEditorViewModel

    private let columns = [GridItem(.adaptive(minimum: 44), spacing: 12)]
    private let icons: [(symbol: String, name: String)] = [
        ("house.fill", "Casa"), ("bed.double.fill", "Quarto"),
        ("sofa.fill", "Sala"), ("tv.fill", "TV"),
        ("display", "Escritório"), ("books.vertical.fill", "Estudo"),
        ("refrigerator.fill", "Geladeira"), ("cabinet.fill", "Armário"),
        ("spigot.fill", "Torneira"), ("cup.and.saucer.fill", "Copa"),
        ("shower.fill", "Chuveiro"), ("toilet.fill", "Banheiro"),
        ("washer.fill", "Lavanderia"), ("trash.fill", "Lixo"),
        ("sparkles", "Limpeza geral"), ("paintbrush.fill", "Manutenção")
    ]

    init(viewModel: RoomEditorViewModel) {
        _viewModel = StateObject(wrappedValue: viewModel)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    VStack(spacing: 20) {
                        RoomIconView(icon: viewModel.state.draft.icon, color: viewModel.state.draft.color)
                        TextField("Nome do Cômodo", text: binding(\.name))
                            .multilineTextAlignment(.center)
                            .font(.title3.bold())
                            .padding()
                            .background(Color(uiColor: .secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 12))
                            .textInputAutocapitalization(.sentences)
                            .submitLabel(.done)
                            .focused($isNameFocused)
                            .onSubmit { isNameFocused = false }
                            .accessibilityLabel("Nome do cômodo")
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 10)
                    .listRowBackground(Color.clear)
                }
                colorSection
                iconSection
                routineSection
                privacySection
                if case let .failure(_, message) = viewModel.state {
                    Section {
                        Label(message, systemImage: "exclamationmark.triangle")
                            .foregroundStyle(.red)
                    }
                }
            }
            .disabled(isSaving)
            .scrollDismissesKeyboard(.interactively)
            .navigationTitle("Novo Cômodo")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancelar") { dismiss() }.disabled(isSaving)
                }
                ToolbarItem(placement: .confirmationAction) {
                    if isSaving {
                        ProgressView("Criando cômodo")
                    } else {
                        Button("Criar") {
                            isNameFocused = false
                            Task { await viewModel.save() }
                        }
                        .disabled(!viewModel.canSave)
                        .accessibilityIdentifier("saveRoom")
                    }
                }
            }
        }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
        .interactiveDismissDisabled(isSaving)
        .task { await viewModel.loadResidents() }
        .onChange(of: viewModel.state) { _, state in
            if case .saved = state { dismiss() }
        }
        .sensoryFeedback(.selection, trigger: viewModel.state.draft.icon)
    }

    private var colorSection: some View {
        Section("Cor") {
            LazyVGrid(columns: columns, spacing: 12) {
                ForEach(RoomColor.allCases, id: \.self) { color in
                    let selected = viewModel.state.draft.color == color
                    Button {
                        viewModel.updateDraft { $0.color = color }
                    } label: {
                        Circle().fill(color.tint)
                            .frame(width: 44, height: 44)
                            .overlay {
                                Circle().stroke(Color(uiColor: .systemBackground), lineWidth: selected ? 4 : 0).padding(-2)
                            }
                            .overlay {
                                Circle().stroke(.gray.opacity(0.5), lineWidth: selected ? 2 : 0).padding(-4)
                            }
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(color.label)
                    .accessibilityAddTraits(selected ? .isSelected : [])
                }
            }
            .padding(.vertical, 8)
        }
    }

    private var iconSection: some View {
        Section("Ícone") {
            LazyVGrid(columns: columns, spacing: 12) {
                ForEach(icons, id: \.symbol) { icon in
                    let selected = viewModel.state.draft.icon == icon.symbol
                    Button {
                        viewModel.updateDraft { $0.icon = icon.symbol }
                    } label: {
                        Image(systemName: icon.symbol)
                            .font(.system(size: 20, weight: selected ? .bold : .regular))
                            .foregroundStyle(selected ? .primary : .secondary)
                            .frame(width: 44, height: 44)
                            .background(Color(uiColor: .tertiarySystemGroupedBackground), in: Circle())
                            .overlay { Circle().stroke(.gray.opacity(0.5), lineWidth: selected ? 2 : 0) }
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(icon.name)
                    .accessibilityAddTraits(selected ? .isSelected : [])
                }
            }
            .padding(.vertical, 8)
        }
    }

    private var routineSection: some View {
        Section("Rotina de Limpeza") {
            Stepper(value: binding(\.periodicity.executionsPerPeriod), in: 1...min(14, viewModel.state.draft.periodicity.intervalWeeks * 7)) {
                let count = viewModel.state.draft.periodicity.executionsPerPeriod
                Text("Limpar: **\(count == 1 ? "1 vez" : "\(count) vezes")**")
            }
            Picker("A cada:", selection: binding(\.periodicity.intervalWeeks)) {
                ForEach(1...12, id: \.self) { week in
                    Text(week == 1 ? "1 semana" : "\(week) semanas").tag(week)
                }
            }
            .tint(.secondary)
            Stepper(value: binding(\.responsibleCount), in: 1...10) {
                Text("Responsáveis por turno: **\(viewModel.state.draft.responsibleCount)**")
            }
        }
    }

    private var privacySection: some View {
        Section {
            Toggle("Cômodo Privado", isOn: Binding(
                get: { viewModel.state.draft.visibility == .privateRoom },
                set: { value in viewModel.updateDraft { $0.visibility = value ? .privateRoom : .common } }
            ))
            if viewModel.state.draft.visibility == .privateRoom {
                NavigationLink {
                    residentsList
                } label: {
                    HStack {
                        Text("Moradores Responsáveis")
                        Spacer()
                        Text("\(viewModel.state.draft.selectedParticipantIDs.count)")
                            .foregroundStyle(.secondary)
                    }
                }
            }
        } header: {
            Text("Privacidade")
        } footer: {
            Text("Selecione os moradores que participam do rodízio nos cômodos privados. Você participa inicialmente e outros moradores podem entrar depois. Nos cômodos comuns, todos participam.")
        }
    }

    private var residentsList: some View {
        List {
            if viewModel.isLoadingResidents {
                ProgressView("Carregando moradores…")
            } else if let error = viewModel.residentsError {
                Text(error).foregroundStyle(.secondary)
                Button("Tentar novamente") { Task { await viewModel.loadResidents() } }
            } else {
                ForEach(viewModel.residents) { resident in
                    let selected = viewModel.state.draft.selectedParticipantIDs.contains(resident.id)
                    Button {
                        viewModel.updateDraft {
                            if selected { $0.selectedParticipantIDs.remove(resident.id) }
                            else { $0.selectedParticipantIDs.insert(resident.id) }
                        }
                    } label: {
                        HStack {
                            Text(resident.name).foregroundStyle(.primary)
                            if viewModel.isCreator(resident.id) { Text("Você").foregroundStyle(.secondary) }
                            Spacer()
                            if selected { Image(systemName: "checkmark").fontWeight(.bold) }
                        }
                    }
                    .disabled(viewModel.isCreator(resident.id))
                    .accessibilityAddTraits(selected ? .isSelected : [])
                }
            }
        }
        .navigationTitle("Moradores")
        .navigationBarTitleDisplayMode(.inline)
    }

    private var isSaving: Bool {
        if case .saving = viewModel.state { return true }
        return false
    }

    private func binding<Value>(_ keyPath: WritableKeyPath<RoomDraft, Value>) -> Binding<Value> {
        Binding(
            get: { viewModel.state.draft[keyPath: keyPath] },
            set: { value in viewModel.updateDraft { $0[keyPath: keyPath] = value } }
        )
    }
}
