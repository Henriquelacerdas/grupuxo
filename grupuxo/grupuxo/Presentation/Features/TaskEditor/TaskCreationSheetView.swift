import SwiftUI

/// Formulário apresentado a partir da aba Casa para cadastrar uma tarefa
struct TaskCreationSheetView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @FocusState private var focusedField: Field?
    @StateObject private var viewModel: TaskEditorViewModel

    private enum Field: Hashable {
        case title, details
    }

    private enum Layout {
        static let cardCornerRadius: CGFloat = 16
        static let rowMinimumHeight = DesignSystem.minimumTouchTarget
            + 2 * DesignSystem.Spacing.extraSmall
    }

    init(viewModel: TaskEditorViewModel) {
        _viewModel = StateObject(wrappedValue: viewModel)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: DesignSystem.Spacing.large) {
                    titleCard

                    VStack(spacing: DesignSystem.Spacing.medium) {
                        selectionRow(
                            title: "Repetição",
                            systemImage: "arrow.triangle.2.circlepath"
                        ) {
                            Menu {
                                Picker("Repetição", selection: binding(\.recurrence)) {
                                    Text("Semanalmente").tag(RecurrencePolicy.weekly(interval: 1))
                                    Text("Sem repetição").tag(RecurrencePolicy.none)
                                }
                            } label: {
                                rowValue(recurrenceName)
                            }
                            .accessibilityLabel("Repetição")
                            .accessibilityValue(recurrenceName)
                        }

                        selectionRow(
                            title: "Cômodo",
                            systemImage: "square.grid.2x2"
                        ) {
                            Menu {
                                Picker("Cômodo", selection: binding(\.roomID)) {
                                    Text("Selecionar").tag(Optional<Room.ID>.none)
                                    ForEach(viewModel.rooms) { room in
                                        if viewModel.state.draft.recurrence == .none {
                                            if room.name == "Casa toda" {
                                                Text(room.name)
                                                    .tag(Optional(room.id))
                                            }
                                        } else {
                                            Text(room.name).tag(Optional(room.id))
                                        }
                                    }
                                }
                            } label: {
                                rowValue(selectedRoomName)
                            }
                            .accessibilityLabel("Cômodo")
                            .accessibilityValue(selectedRoomName)
                        }

                        effortCard
                    }

                    if case let .failure(_, message) = viewModel.state {
                        Label(message, systemImage: "exclamationmark.triangle")
                            .font(.footnote)
                            .foregroundStyle(.red)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
                .padding(DesignSystem.Spacing.large)
                .disabled(isSaving)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(Color(uiColor: .systemGroupedBackground))
            .navigationTitle("Criar tarefa")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Fechar", systemImage: "xmark") { dismiss() }
                        .labelStyle(.iconOnly)
                        .accessibilityLabel("Fechar")
                        .disabled(isSaving)
                }

                ToolbarItem(placement: .confirmationAction) {
                    if isSaving {
                        ProgressView("Salvando tarefa")
                    } else {
                        Button("Salvar", systemImage: "checkmark") {
                            focusedField = nil
                            Task { await viewModel.save() }
                        }
                        .labelStyle(.iconOnly)
                        .accessibilityLabel("Salvar tarefa")
                    }
                }
            }
        }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
        .interactiveDismissDisabled(isSaving)
        .task { await viewModel.loadRooms() }
        .onChange(of: viewModel.state) { _, state in
            if case .saved = state { dismiss() }
        }
    }

    private var titleCard: some View {
        VStack(spacing: 0) {
            TextField("Título", text: binding(\.name))
                .textInputAutocapitalization(.sentences)
                .submitLabel(.next)
                .focused($focusedField, equals: .title)
                .onSubmit { focusedField = .details }
                .accessibilityLabel("Título da tarefa")
                .padding(.vertical, DesignSystem.Spacing.large)

            Divider()

            TextField("Descrição", text: binding(\.details), axis: .vertical)
                .lineLimit(2...4)
                .textInputAutocapitalization(.sentences)
                .focused($focusedField, equals: .details)
                .accessibilityLabel("Descrição da tarefa")
                .padding(.vertical, DesignSystem.Spacing.large)
        }
        .padding(.horizontal, DesignSystem.Spacing.large)
        .background(cardBackground)
    }

    private var effortCard: some View {
        VStack(alignment: .leading, spacing: DesignSystem.Spacing.large) {
            
            adaptiveRow {
                Label("Esforço", systemImage: "bolt")
                    .font(.callout.weight(.medium))
                
                if !dynamicTypeSize.isAccessibilitySize { Spacer() }
                
                Text("Nível \(viewModel.state.draft.effortPoints) · \(effortName)")
                    .font(.footnote.weight(.medium))
                    .foregroundStyle(.secondary)
            }

            if dynamicTypeSize.isAccessibilitySize {
                effortPicker.pickerStyle(.inline)
            } else {
                effortPicker.pickerStyle(.segmented)
            }
            
        }
        .padding(DesignSystem.Spacing.large)
        .background(cardBackground)
    }

    private func selectionRow<Control: View>(title: String, systemImage: String, @ViewBuilder control: () -> Control) -> some View {
        
        adaptiveRow {
            Label(title, systemImage: systemImage)
                .font(.callout.weight(.medium))
            if !dynamicTypeSize.isAccessibilitySize { Spacer() }
            control()
        }
        .padding(.horizontal, DesignSystem.Spacing.large)
        .padding(.vertical, DesignSystem.Spacing.extraSmall)
        .frame(minHeight: Layout.rowMinimumHeight)
        .background(cardBackground)
        .accessibilityElement(children: .contain)
    }

    private func rowValue(_ value: String) -> some View {
        HStack(spacing: DesignSystem.Spacing.extraSmall) {
            Text(value)
            Image(systemName: "chevron.right")
                .font(.caption.weight(.semibold))
                .accessibilityHidden(true)
        }
        .font(.callout)
        .foregroundStyle(.secondary)
        .frame(minHeight: DesignSystem.minimumTouchTarget)
    }

    private var effortPicker: some View {
        Picker("Nível de esforço", selection: binding(\.effortPoints)) {
            Text("1 · Leve").tag(1)
            Text("2 · Médio").tag(2)
            Text("3 · Intenso").tag(3)
        }
    }

    private func adaptiveRow<Content: View>(@ViewBuilder content: () -> Content) -> some View {
        let layout = dynamicTypeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: DesignSystem.Spacing.small))
            : AnyLayout(HStackLayout(spacing: DesignSystem.Spacing.large))
        return layout {
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var cardBackground: some View {
        RoundedRectangle(cornerRadius: Layout.cardCornerRadius, style: .continuous)
            .fill(Color(uiColor: .secondarySystemGroupedBackground))
    }

    private var selectedRoomName: String {
        guard let roomID = viewModel.state.draft.roomID,
              let room = viewModel.rooms.first(where: { $0.id == roomID }) else {
            return "Selecionar"
        }
        return room.name
    }

    private var effortName: String {
        switch viewModel.state.draft.effortPoints {
        case 1: "Leve"
        case 2: "Médio"
        default: "Intenso"
        }
    }

    private var recurrenceName: String {
        switch viewModel.state.draft.recurrence {
        case .none: "Sem repetição"
        case .weekly: "Semanalmente"
        }
    }

    private var isSaving: Bool {
        if case .saving = viewModel.state { true }
        else { false }
    }

    private func binding<Value>(_ keyPath: WritableKeyPath<TaskDraft, Value>) -> Binding<Value> {
        Binding(
            get: { viewModel.state.draft[keyPath: keyPath] },
            set: { value in viewModel.updateDraft { $0[keyPath: keyPath] = value } }
        )
    }
}
