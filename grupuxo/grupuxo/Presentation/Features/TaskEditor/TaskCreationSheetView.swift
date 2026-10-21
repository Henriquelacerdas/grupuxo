import SwiftUI

import UIKit

import GrupuxoDomain

private extension TaskEffortLevel {

    var title: String {

        switch self {

        case .light: "Leve"

        case .medium: "Médio"

        case .intense: "Intenso"

        }

    }

}

/// UIKit owns tracking, selection, and the iOS 26 Liquid Glass lens.

/// Only the segment artwork is custom; never override the control's backgrounds.

private struct EffortSegmentedControl: UIViewRepresentable {

    @Binding var selection: Int

    @Environment(\.isEnabled) private var isEnabled

    @Environment(\.colorScheme) private var colorScheme

    @Environment(\.displayScale) private var displayScale

    @ScaledMetric(relativeTo: .callout) private var fontSize: CGFloat = 16

    func makeCoordinator() -> Coordinator { Coordinator(selection: $selection) }

    func makeUIView(context: Context) -> UISegmentedControl {

        let control = UISegmentedControl(items: TaskEffortLevel.allCases.map(\.title))

        control.addTarget(context.coordinator, action: #selector(Coordinator.changed(_:)), for: .valueChanged)

        control.setContentHuggingPriority(.defaultLow, for: .horizontal)

        control.accessibilityIdentifier = "taskEffortPicker"

        return control

    }

    func updateUIView(_ control: UISegmentedControl, context: Context) {

        context.coordinator.selection = $selection

        control.isEnabled = isEnabled

        // Replacing images during valueChanged interrupts native lens tracking.

        let appearance = "\(fontSize)-\(colorScheme)-\(displayScale)"

        if context.coordinator.appearance != appearance {

            context.coordinator.appearance = appearance

            for (index, level) in TaskEffortLevel.allCases.enumerated() {

                let artwork = VStack(spacing: 2) {

                    HStack(spacing: 2) {

                        ForEach(0..<level.rawValue, id: \.self) { _ in

                            Image(systemName: "bolt.fill")

                        }

                    }

                    .foregroundStyle(Color.accentColor)

                    Text(level.title).foregroundStyle(.primary)

                }

                .font(.system(size: fontSize))

                .padding(.vertical, 4)

                .frame(width: fontSize * 4.5)

                .environment(\.colorScheme, colorScheme)

                let renderer = ImageRenderer(content: artwork)

                renderer.scale = displayScale

                if let image = renderer.uiImage?.withRenderingMode(.alwaysOriginal) {

                    image.accessibilityLabel = "\(level.title), esforço \(level.rawValue) de 3"

                    control.setImage(image, forSegmentAt: index)

                }

            }

        }

        let index = TaskEffortLevel.allCases.firstIndex { $0.rawValue == selection } ?? 0

        if control.selectedSegmentIndex != index {

            control.selectedSegmentIndex = index

        }

    }

    func sizeThatFits(_ proposal: ProposedViewSize, uiView: UISegmentedControl, context: Context) -> CGSize? {

        CGSize(width: proposal.width ?? uiView.intrinsicContentSize.width,

               height: max(64, fontSize * 3.5 + 8))

    }

    @MainActor

    final class Coordinator: NSObject {

        var selection: Binding<Int>

        var appearance: String?

        init(selection: Binding<Int>) { self.selection = selection }

        @objc func changed(_ sender: UISegmentedControl) {

            guard TaskEffortLevel.allCases.indices.contains(sender.selectedSegmentIndex) else { return }

            selection.wrappedValue = TaskEffortLevel.allCases[sender.selectedSegmentIndex].rawValue

        }

    }

}

/// Formulário apresentado a partir da aba Casa para cadastrar uma tarefa

struct TaskCreationSheetView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    @FocusState private var focusedField: Field?
    @StateObject private var viewModel: TaskEditorViewModel

    @State private var recurrenceSheet: RecurrenceSheet?
    @State private var titleText: String
    @State private var detailsText: String

    private enum Field: Hashable {
        case title, details
    }

    private enum Layout {
        static let cardCornerRadius: CGFloat = 26
        static let effortRaySpacing: CGFloat = 2
        static let rowMinimumHeight =
            DesignSystem.minimumTouchTarget
            + 2 * DesignSystem.Spacing.extraSmall
    }

    init(viewModel: TaskEditorViewModel) {
        _viewModel = StateObject(wrappedValue: viewModel)
        _titleText = State(initialValue: viewModel.state.draft.name)
        _detailsText = State(initialValue: viewModel.state.draft.details)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: DesignSystem.Spacing.large) {
                    titleCard

                    VStack(spacing: DesignSystem.Spacing.large) {
                        uniqueTaskRow

                        if !isUniqueTask {
                            recurrenceSection
                        }

                        roomRow
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
            .navigationTitle("Criar Tarefa")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Fechar", systemImage: "xmark") {
                        dismiss()
                    }
                    .labelStyle(.iconOnly)
                    .accessibilityLabel("Fechar")
                    .disabled(isSaving)
                }

                ToolbarItem(placement: .topBarTrailing) {
                    if isSaving {
                        ProgressView("Salvando tarefa")
                    } else if canSave {
                        saveButton
                            .buttonStyle(.borderedProminent)
                    } else {
                        saveButton
                            .buttonStyle(.bordered)
                            .disabled(true)
                    }
                }
            }
        }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
        .interactiveDismissDisabled(isSaving)
        .sheet(item: $recurrenceSheet) { sheet in
            switch sheet {
            case let .custom(recurrence):
                CustomRecurrenceSheet(
                    viewModel: viewModel,
                    initialRecurrence: recurrence
                )
            }
        }
        .task {
            await viewModel.loadRooms()
        }
        .onChange(of: viewModel.state) { _, state in
            if case .saved = state {
                dismiss()
            }
        }
    }

    private var titleCard: some View {
        VStack(spacing: DesignSystem.Spacing.large) {
            TextField("Título", text: $titleText)
                .font(.body.weight(.medium))
                .textInputAutocapitalization(.sentences)
                .submitLabel(.next)
                .focused($focusedField, equals: .title)
                .onSubmit {
                    focusedField = .details
                }
                .accessibilityLabel("Título da tarefa")
                .padding(.horizontal, DesignSystem.Spacing.large)
                .frame(minHeight: 52)
                .background(cardBackground)

            TextField(
                "Descrição",
                text: $detailsText,
                axis: .vertical
            )
            .font(.body.weight(.medium))
            .lineLimit(1...4)
            .textInputAutocapitalization(.sentences)
            .focused($focusedField, equals: .details)
            .accessibilityLabel("Descrição da tarefa")
            .padding(.horizontal, DesignSystem.Spacing.large)
            .frame(minHeight: 52)
            .background(cardBackground)
        }
    }

    private var uniqueTaskRow: some View {
        Toggle(isOn: uniqueTaskBinding) {
            HStack(spacing: DesignSystem.Spacing.small) {
                Image(systemName: "flag")
                    .foregroundStyle(.tint)

                Text("Tarefa Única")
                    .font(.body)
            }
        }
        .padding(.horizontal, DesignSystem.Spacing.large)
        .padding(.vertical, DesignSystem.Spacing.extraSmall)
        .frame(minHeight: Layout.rowMinimumHeight)
        .background(cardBackground)
        .accessibilityElement(children: .contain)
    }

    private var recurrenceSection: some View {
        VStack(
            alignment: .leading,
            spacing: DesignSystem.Spacing.small
        ) {
            selectionRow(
                title: "Repetição",
                systemImage: "repeat"
            ) {
                Menu {
                    recurrenceMenu
                } label: {
                    rowValue(recurrenceName)
                }
                .accessibilityLabel("Repetição")
                .accessibilityValue(recurrenceName)
                .foregroundStyle(.secondary)
            }

            Text(
                "Tarefas que ocorrem na mesma frequência do cômodo entram no ciclo. As que têm frequência diferente são consideradas Tarefas Extras."
            )
            .font(.footnote)
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var roomRow: some View {
        selectionRow(
            title: "Cômodo",
            systemImage: "house"
        ) {
            Menu {
                Picker(
                    "Cômodo",
                    selection: binding(\.roomID)
                ) {
                    Text("Selecionar")
                        .tag(Optional<Room.ID>.none)

                    ForEach(viewModel.rooms) { room in
                        Text(room.name)
                            .tag(Optional(room.id))
                    }
                }
            } label: {
                rowValue(selectedRoomName)
            }
            .accessibilityLabel("Cômodo")
            .accessibilityValue(selectedRoomName)
            .foregroundStyle(.secondary)
        }
    }

    private var effortCard: some View {
        VStack(
            alignment: .leading,
            spacing: DesignSystem.Spacing.large
        ) {
            adaptiveRow {
                Label {
                    Text("Esforço")
                        .font(.body)
                } icon: {
                    Image(systemName: "bolt.fill")
                        .foregroundStyle(.tint)
                }

                if !dynamicTypeSize.isAccessibilitySize {
                    Spacer(minLength: 0)
                }

                HStack(spacing: DesignSystem.Spacing.extraSmall) {
                    effortRays(
                        for: selectedEffortLevel,
                        color: .secondary
                    )

                    Text("– \(selectedEffortLevel.title)")
                        .font(.body)
                        .foregroundStyle(.secondary)
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(
                    "Esforço \(selectedEffortLevel.title), nível \(selectedEffortLevel.rawValue) de \(TaskEffortLevel.allCases.count)"
                )
            }

            effortPicker
        }
        .padding(DesignSystem.Spacing.large)
        .background(cardBackground)
    }

    private var saveButton: some View {
        Button("Salvar", systemImage: "checkmark") {
            focusedField = nil

            viewModel.updateDraft { draft in
                draft.name = titleText
                draft.details = detailsText
            }

            Task {
                await viewModel.save()
            }
        }
        .labelStyle(.iconOnly)
        .accessibilityLabel("Salvar tarefa")
    }

    private var uniqueTaskBinding: Binding<Bool> {
        Binding(
            get: {
                viewModel.state.draft.kind == .sporadic
            },
            set: { isUnique in
                viewModel.updateDraft { draft in
                    draft.kind = isUnique ? .sporadic : .recurring
                }
            }
        )
    }

    private var isUniqueTask: Bool {
        viewModel.state.draft.kind == .sporadic
    }

    private var canSave: Bool {
        let hasTitle = !titleText
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .isEmpty

        let hasRoom = viewModel.state.draft.roomID != nil

        return hasTitle && hasRoom
    }

    private func selectionRow<Control: View>(
        title: String,
        systemImage: String,
        @ViewBuilder control: () -> Control
    ) -> some View {
        adaptiveRow {
            HStack(spacing: DesignSystem.Spacing.small) {
                Image(systemName: systemImage)
                    .foregroundStyle(.tint)

                Text(title)
                    .font(.body)
            }

            if !dynamicTypeSize.isAccessibilitySize {
                Spacer()
            }

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

            Image(systemName: "chevron.up.chevron.down")
                .font(.caption.weight(.semibold))
                .accessibilityHidden(true)
        }
        .font(.body)
        .foregroundStyle(.secondary)
        .frame(minHeight: DesignSystem.minimumTouchTarget)
    }

    private var effortPicker: some View {
        Group {
            if dynamicTypeSize.isAccessibilitySize {
                Picker(
                    "Nível de esforço",
                    selection: binding(\.effortPoints)
                ) {
                    ForEach(TaskEffortLevel.allCases) { level in
                        Text(level.title)
                            .accessibilityLabel(
                                "\(level.title), esforço \(level.rawValue) de 3"
                            )
                            .tag(level.rawValue)
                    }
                }
                .pickerStyle(.menu)
                .frame(minHeight: DesignSystem.minimumTouchTarget)
            } else {
                EffortSegmentedControl(
                    selection: binding(\.effortPoints)
                )
            }
        }
        .accessibilityIdentifier("taskEffortPicker")
        .sensoryFeedback(
            .selection,
            trigger: viewModel.state.draft.effortPoints
        )
    }

    private func effortRays<Style: ShapeStyle>(
        for level: TaskEffortLevel,
        color: Style
    ) -> some View {
        HStack(spacing: Layout.effortRaySpacing) {
            ForEach(0..<level.rawValue, id: \.self) { _ in
                Image(systemName: "bolt.fill")
            }
        }
        .font(.callout)
        .foregroundStyle(color)
    }

    private var recurrenceMenu: some View {
        Group {
            Button("Mesma do cômodo") {
                viewModel.useRoomPeriodicity()
            }
            .disabled(viewModel.state.draft.roomID == nil)

            Divider()

            recurrenceMenuButton(
                "Diariamente",
                recurrence: .recurring(frequency: .daily, interval: 1)
            )
            recurrenceMenuButton(
                "Semanalmente",
                recurrence: .recurring(frequency: .weekly, interval: 1)
            )
            recurrenceMenuButton(
                "Quinzenalmente",
                recurrence: .recurring(frequency: .weekly, interval: 2)
            )
            recurrenceMenuButton(
                "Mensalmente",
                recurrence: .recurring(frequency: .monthly, interval: 1)
            )
            recurrenceMenuButton(
                "A cada 3 meses",
                recurrence: .recurring(frequency: .monthly, interval: 3)
            )
            recurrenceMenuButton(
                "A cada 6 meses",
                recurrence: .recurring(frequency: .monthly, interval: 6)
            )
            recurrenceMenuButton(
                "Anualmente",
                recurrence: .recurring(frequency: .yearly, interval: 1)
            )

            Divider()

            Button("Personalizado") {
                recurrenceSheet = .custom(
                    viewModel.state.draft.recurrence
                )
            }
        }
    }

    private func recurrenceMenuButton(
        _ title: String,
        recurrence: RecurrencePolicy
    ) -> some View {
        Button(title) {
            viewModel.selectRecurrence(recurrence)
        }
    }

    private func adaptiveRow<Content: View>(
        @ViewBuilder content: () -> Content
    ) -> some View {
        let layout = dynamicTypeSize.isAccessibilitySize
            ? AnyLayout(
                VStackLayout(
                    alignment: .leading,
                    spacing: DesignSystem.Spacing.small
                )
            )
            : AnyLayout(
                HStackLayout(
                    spacing: DesignSystem.Spacing.large
                )
            )

        return layout {
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var cardBackground: some View {
        RoundedRectangle(
            cornerRadius: Layout.cardCornerRadius,
            style: .continuous
        )
        .fill(Color(uiColor: .secondarySystemGroupedBackground))
    }

    private var selectedRoomName: String {
        guard
            let roomID = viewModel.state.draft.roomID,
            let room = viewModel.rooms.first(where: { $0.id == roomID })
        else {
            return "Selecionar"
        }

        return room.name
    }

    private var selectedEffortLevel: TaskEffortLevel {
        TaskEffortLevel(
            rawValue: viewModel.state.draft.effortPoints
        ) ?? .light
    }

    private var recurrenceName: String {
        switch viewModel.state.draft.recurrence {
        case .none:
            "Sem repetição"

        case let .weekly(value):
            value.label

        case let .recurring(frequency, interval):
            RecurrencePresentation.name(
                for: frequency,
                interval: interval
            )
        }
    }

    private var isSaving: Bool {
        if case .saving = viewModel.state {
            true
        } else {
            false
        }
    }

    private func binding<Value>(
        _ keyPath: WritableKeyPath<TaskDraft, Value>
    ) -> Binding<Value> {
        Binding(
            get: {
                viewModel.state.draft[keyPath: keyPath]
            },
            set: { value in
                viewModel.updateDraft {
                    $0[keyPath: keyPath] = value
                }
            }
        )
    }

    private enum RecurrenceSheet: Identifiable {
        case custom(RecurrencePolicy)

        var id: String {
            "custom"
        }
    }
}

private struct CustomRecurrenceSheet: View {

    @Environment(\.dismiss) private var dismiss

    @ObservedObject var viewModel: TaskEditorViewModel

    @State private var frequency: RecurrenceFrequency

    @State private var interval: Int

    @State private var executions: Int

    init(viewModel: TaskEditorViewModel, initialRecurrence: RecurrencePolicy) {

        self.viewModel = viewModel

        _executions = State(initialValue: initialRecurrence.weeklyPeriodicity?.executionsPerPeriod ?? 1)

        switch initialRecurrence {

        case let .weekly(value):

            _frequency = State(initialValue: .weekly)

            _interval = State(initialValue: value.intervalWeeks)

        case let .recurring(frequency, interval):

            _frequency = State(initialValue: frequency)

            _interval = State(initialValue: max(interval, 1))

        case .none:

            _frequency = State(initialValue: .weekly)

            _interval = State(initialValue: 1)

        }

    }

    var body: some View {

        NavigationStack {

            Form {

                Section {

                    Picker("Frequência", selection: $frequency) {

                        ForEach(RecurrenceFrequency.allCases, id: \.self) { frequency in

                            Text(RecurrencePresentation.frequencyName(for: frequency)).tag(frequency)

                        }

                    }

                    if frequency == .weekly {

                        Stepper("Execuções: \(executions)", value: $executions, in: 1...max(1, interval * 7))

                    }

                    Stepper(value: $interval, in: 1...999) {

                        HStack {

                            Text("A cada")

                            Spacer()

                            Text(interval.formatted())

                                .foregroundStyle(.secondary)

                        }

                    }

                    .accessibilityValue("\(interval) \(RecurrencePresentation.unitName(for: frequency, interval: interval))")

                }

                Section {

                    Text(recurrenceSummary)

                        .foregroundStyle(.secondary)

                }

            }

            .navigationTitle("Personalizado")

            .navigationBarTitleDisplayMode(.inline)

            .toolbar {

                ToolbarItem(placement: .cancellationAction) {

                    Button("Cancelar", systemImage: "xmark") { dismiss() }

                        .labelStyle(.iconOnly)

                        .accessibilityLabel("Cancelar recorrência personalizada")

                }

                ToolbarItem(placement: .confirmationAction) {

                    Button("Concluir", systemImage: "checkmark") {

                        viewModel.selectRecurrence(frequency == .weekly ? .weekly(WeeklyPeriodicity(executionsPerPeriod: executions, intervalWeeks: interval)) : .recurring(frequency: frequency, interval: interval))

                        dismiss()

                    }

                    .labelStyle(.iconOnly)

                    .accessibilityLabel("Concluir recorrência personalizada")

                }

            }

        }

        .presentationDetents([.medium, .large])

        .presentationDragIndicator(.hidden)

    }

    private var recurrenceSummary: String {

        RecurrencePresentation.summary(for: frequency, interval: interval)

    }

}

private enum RecurrencePresentation {

    static func name(for frequency: RecurrenceFrequency, interval: Int) -> String {

        switch (frequency, interval) {

        case (.daily, 1): "Diariamente"

        case (.weekly, 1): "Semanalmente"

        case (.weekly, 2): "Quinzenalmente"

        case (.monthly, 1): "Mensalmente"

        case (.monthly, 3): "A cada 3 meses"

        case (.monthly, 6): "A cada 6 meses"

        case (.yearly, 1): "Anualmente"

        default: "A cada \(interval) \(unitName(for: frequency, interval: interval))"

        }

    }

    static func frequencyName(for frequency: RecurrenceFrequency) -> String {

        switch frequency {

        case .daily: "Diariamente"

        case .weekly: "Semanalmente"

        case .monthly: "Mensalmente"

        case .yearly: "Anualmente"

        }

    }

    static func summary(for frequency: RecurrenceFrequency, interval: Int) -> String {

        if interval == 1 {

            switch frequency {

            case .daily: return "A tarefa ocorrerá todos os dias."

            case .weekly: return "A tarefa ocorrerá toda semana."

            case .monthly: return "A tarefa ocorrerá todo mês."

            case .yearly: return "A tarefa ocorrerá todo ano."

            }

        }

        return "A tarefa ocorrerá a cada \(interval) \(unitName(for: frequency, interval: interval))."

    }

    static func unitName(for frequency: RecurrenceFrequency, interval: Int) -> String {

        switch frequency {

        case .daily: interval == 1 ? "dia" : "dias"

        case .weekly: interval == 1 ? "semana" : "semanas"

        case .monthly: interval == 1 ? "mês" : "meses"

        case .yearly: interval == 1 ? "ano" : "anos"

        }

    }

}
