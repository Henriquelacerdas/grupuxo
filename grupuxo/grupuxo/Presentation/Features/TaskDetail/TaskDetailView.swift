//
//  TaskDetailView.swift
//  grupuxo
//
//  Created by Giovanna Spigariol on 30/09/26.
//

import Foundation
import SwiftUI
import GrupuxoDomain

/// Detalhes da tarefa numa sheet: cabeçalho do cômodo, descrição, rodízio e detalhes.
struct TaskDetailView: View {

    @Environment(\.dismiss)
    private var dismiss

    @StateObject private var viewModel: TaskDetailViewModel

    @State private var editingDefinition: TaskDefinition?

    @State private var isConfirmingEnd = false

    @State private var isShowingFullQueue = false

    /// `false` esconde "Editar" (a `api` ainda não tem rota de edição de tarefa).
    private let allowsEditing: Bool

    /// Quantas linhas do rodízio aparecem recolhidas: a vez atual e a próxima.
    private static let collapsedQueueCount = 2

    init(
        viewModel: TaskDetailViewModel,
        allowsEditing: Bool = true
    ) {

        _viewModel = StateObject(
            wrappedValue: viewModel
        )
        self.allowsEditing = allowsEditing

    }

    var body: some View {

        NavigationStack {

            Group {

                switch viewModel.state {

                case .idle, .loading:

                    ProgressView(
                        "Carregando tarefa…"
                    )

                case let .content(definition):

                    content(of: definition)

                case let .failure(message):

                    ContentUnavailableView(
                        "Não foi possível carregar",
                        systemImage: "exclamationmark.triangle",
                        description: Text(
                            message
                        )
                    )

                }

            }
            .frame(
                maxWidth: .infinity,
                maxHeight: .infinity
            )
            .background(
                Color(uiColor: .systemGroupedBackground)
            )
            .navigationBarTitleDisplayMode(
                .inline
            )
            .toolbar {

                ToolbarItem(
                    placement: .cancellationAction
                ) {

                    Button(
                        "Fechar",
                        systemImage: "xmark"
                    ) {

                        dismiss()

                    }
                    .labelStyle(.iconOnly)

                }

                ToolbarItem(
                    placement: .confirmationAction
                ) {

                    if allowsEditing, case let .content(definition) =
                        viewModel.state {

                        Button("Editar") {

                            editingDefinition =
                                definition

                        }

                    }

                }

            }

        }
        .sheet(
            item: $editingDefinition
        ) { definition in

            TaskDetailsEditSheet(
                viewModel: viewModel,
                definition: definition
            )

        }
        .alert(
            "Apagar tarefa?",
            isPresented: $isConfirmingEnd
        ) {

            Button(
                "Cancelar",
                role: .cancel
            ) {}

            Button(
                "Apagar",
                role: .destructive
            ) {

                Task {

                    await viewModel.end()

                }

            }

        } message: {

            Text(
                "A tarefa não será mais repetida. O histórico fica, e a vez atual continua até ser concluída."
            )

        }
        .alert(
            "Não foi possível concluir a ação",
            isPresented: Binding(
                get: {
                    viewModel.actionError != nil
                        && editingDefinition == nil
                },
                set: {
                    if !$0 {
                        viewModel.actionError = nil
                    }
                }
            )
        ) {

            Button("OK") {

                viewModel.actionError = nil

            }

        } message: {

            Text(
                viewModel.actionError ?? ""
            )

        }
        .onChange(
            of: viewModel.wasEnded
        ) { _, wasEnded in

            if wasEnded {
                dismiss()
            }

        }
        .task {

            await viewModel.load()

        }

    }

    private func content(
        of definition: TaskDefinition
    ) -> some View {

        ScrollView {

            VStack(
                alignment: .leading,
                spacing: DesignSystem.Spacing.large
            ) {

                TaskDetailHeader(
                    name: definition.name,
                    room: viewModel.room,
                    deadline: viewModel.deadlineSummary(
                        of: definition
                    ),
                    kind: viewModel.kindSummary(
                        of: definition
                    )
                )

                if !definition.details.isEmpty {

                    TaskDetailSection("Descrição") {

                        Text(
                            definition.details
                        )
                        .frame(
                            maxWidth: .infinity,
                            alignment: .leading
                        )
                        .padding(
                            DesignSystem.Spacing.large
                        )

                    }

                }

                if !viewModel.upcoming.isEmpty {

                    queueSection

                }

                TaskDetailSection("Detalhes") {

                    detailRows(of: definition)

                }

                actions(for: definition)

            }
            .padding(
                .horizontal,
                DesignSystem.Spacing.large
            )
            .padding(
                .bottom,
                DesignSystem.Spacing.large
            )

        }

    }

    /// Só a vez atual e a próxima; "Ver mais" abre a sequência dos demais moradores.
    private var queueSection: some View {

        let assignments = viewModel.upcoming

        let visible = isShowingFullQueue
            ? assignments
            : Array(assignments.prefix(Self.collapsedQueueCount))

        return TaskDetailSection("Rodízio") {

            ForEach(
                Array(visible.enumerated()),
                id: \.element.id
            ) { index, assignment in

                if index > 0 {
                    Divider()
                        .padding(
                            .leading,
                            DesignSystem.Spacing.large
                        )
                }

                UpcomingAssignmentRow(
                    assignment: assignment,
                    position: position(
                        at: index
                    ),
                    currentUserID:
                        viewModel.currentUserID
                )

            }

            if assignments.count > Self.collapsedQueueCount {

                Divider()
                    .padding(
                        .leading,
                        DesignSystem.Spacing.large
                    )

                queueToggle

            }

        }

    }

    private var queueToggle: some View {

        Button {

            withAnimation {

                isShowingFullQueue.toggle()

            }

        } label: {

            HStack(
                spacing: DesignSystem.Spacing.small
            ) {

                Text(
                    isShowingFullQueue
                        ? "Ver menos"
                        : "Ver mais"
                )

                Image(
                    systemName: "chevron.down"
                )
                .font(.footnote.weight(.semibold))
                .rotationEffect(
                    .degrees(
                        isShowingFullQueue ? 180 : 0
                    )
                )
                .accessibilityHidden(true)

            }
            .frame(
                maxWidth: .infinity,
                minHeight: DesignSystem.minimumTouchTarget
            )
            .contentShape(Rectangle())

        }
        .buttonStyle(.plain)
        .foregroundStyle(.tint)
        .accessibilityValue(
            isShowingFullQueue
                ? "Expandido"
                : "Recolhido"
        )
        .accessibilityHint(
            isShowingFullQueue
                ? "Mostra só a vez atual e a próxima"
                : "Mostra a sequência dos demais moradores"
        )

    }

    @ViewBuilder
    private func detailRows(
        of definition: TaskDefinition
    ) -> some View {

        let rows = detailItems(of: definition)

        ForEach(
            Array(rows.enumerated()),
            id: \.element.title
        ) { index, row in

            if index > 0 {
                Divider()
                    .padding(
                        .leading,
                        DesignSystem.Spacing.large
                    )
            }

            TaskDetailRow(
                title: row.title,
                systemImage: row.systemImage,
                value: row.value,
                valueSystemImage: row.valueSystemImage
            )

        }

    }

    private func detailItems(
        of definition: TaskDefinition
    ) -> [TaskDetailItem] {

        var rows: [TaskDetailItem] = []

        if let room = viewModel.room {

            rows.append(
                TaskDetailItem(
                    title: "Cômodo",
                    systemImage: "house",
                    value: room.name
                )
            )

        }

        rows.append(
            TaskDetailItem(
                title: "Repetição",
                systemImage: "repeat",
                value: TaskDetailText.recurrence(
                    definition.recurrence
                )
            )
        )

        rows.append(
            TaskDetailItem(
                title: "Esforço",
                systemImage: "bolt",
                value: RoomDetailText.effort(
                    definition.effort
                ),
                valueSystemImage: "bolt.fill"
            )
        )

        if let completedAt = viewModel.lastCompleted?
            .occurrence.completedAt {

            rows.append(
                TaskDetailItem(
                    title: "Última vez",
                    systemImage: "clock.arrow.circlepath",
                    value: TaskDetailText.lastDone(
                        completedAt
                    )
                )
            )

        }

        if let name = viewModel.lastCompleted?.assignee?.name {

            rows.append(
                TaskDetailItem(
                    title: "Último morador",
                    systemImage: "person.crop.circle.badge.clock",
                    value: ResidentNameFormatting.shortName(
                        name
                    )
                )
            )

        }

        return rows

    }

    @ViewBuilder
    private func actions(
        for definition: TaskDefinition
    ) -> some View {

        VStack(
            spacing: DesignSystem.Spacing.medium
        ) {

            if viewModel.canComplete {

                Button {

                    Task {

                        await viewModel.complete()

                    }

                } label: {

                    Text("Marcar como concluída")
                        .frame(
                            maxWidth: .infinity,
                            minHeight: DesignSystem.minimumTouchTarget
                        )

                }
                .buttonStyle(.borderedProminent)

            }

            if viewModel.canEnd(definition) {

                Button(
                    role: .destructive
                ) {

                    isConfirmingEnd = true

                } label: {

                    Text("Apagar tarefa")
                        .frame(
                            maxWidth: .infinity,
                            minHeight: DesignSystem.minimumTouchTarget
                        )

                }
                .buttonStyle(.bordered)
                .tint(.red)

            }

        }
        .buttonBorderShape(.capsule)
        .disabled(
            viewModel.isPerformingAction
        )

    }

    /// "Atual" para quem está com a vez, "Próximo" para o seguinte; os demais mostram a data.
    private func position(
        at index: Int
    ) -> UpcomingAssignmentRow.Position {

        let assignment = viewModel.upcoming[index]

        if assignment.isCurrent {
            return .current
        }

        let hasCurrent = viewModel.upcoming.first?.isCurrent == true

        return index == (hasCurrent ? 1 : 0)
            ? .next
            : .later

    }

}

private struct TaskDetailItem {

    let title: String
    let systemImage: String
    let value: String
    var valueSystemImage: String?

}

/// Ícone do cômodo ao lado do nome e das duas linhas de apoio.
private struct TaskDetailHeader: View {

    let name: String
    let room: Room?
    let deadline: String?
    let kind: String

    @ScaledMetric(relativeTo: .largeTitle)
    private var iconSize: CGFloat = 72

    var body: some View {

        HStack(
            spacing: DesignSystem.Spacing.large
        ) {

            if let room {

                RoomIconView(
                    icon: room.icon,
                    color: room.color,
                    size: iconSize
                )

            }

            VStack(
                alignment: .leading,
                spacing: DesignSystem.Spacing.extraSmall
            ) {

                Text(name)
                    .font(.title2.bold())

                if let deadline {

                    Text(deadline)
                        .font(.subheadline)

                }

                Text(kind)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)

            }

        }
        .frame(
            maxWidth: .infinity,
            alignment: .leading
        )
        .accessibilityElement(
            children: .combine
        )

    }

}

/// Título de seção e cartão arredondado com as linhas dentro.
private struct TaskDetailSection<Content: View>: View {

    private let title: LocalizedStringKey
    private let content: Content

    init(
        _ title: LocalizedStringKey,
        @ViewBuilder content: () -> Content
    ) {

        self.title = title
        self.content = content()

    }

    var body: some View {

        VStack(
            alignment: .leading,
            spacing: DesignSystem.Spacing.small
        ) {

            Text(title)
                .font(.headline)
                .accessibilityAddTraits(
                    .isHeader
                )

            VStack(
                spacing: 0
            ) {

                content

            }
            .cardBackground()

        }

    }

}

private struct TaskDetailRow: View {

    let title: String
    let systemImage: String
    let value: String
    var valueSystemImage: String?

    @ScaledMetric(relativeTo: .body)
    private var iconWidth: CGFloat = 28

    var body: some View {

        HStack(
            spacing: DesignSystem.Spacing.medium
        ) {

            Image(systemName: systemImage)
                .font(.title3)
                .foregroundStyle(.tint)
                .frame(width: iconWidth)
                .accessibilityHidden(true)

            Text(title)

            Spacer(
                minLength: DesignSystem.Spacing.small
            )

            Group {

                if let valueSystemImage {

                    Label(
                        value,
                        systemImage: valueSystemImage
                    )

                } else {

                    Text(value)

                }

            }
            .foregroundStyle(.secondary)
            .multilineTextAlignment(.trailing)

        }
        .padding(
            .horizontal,
            DesignSystem.Spacing.large
        )
        .padding(
            .vertical,
            DesignSystem.Spacing.medium
        )
        .accessibilityElement(
            children: .combine
        )

    }

}

private struct TaskDetailsEditSheet: View {

    @Environment(\.dismiss)
    private var dismiss

    @ObservedObject
    var viewModel: TaskDetailViewModel

    @State
    private var name: String

    @State
    private var details: String

    init(
        viewModel: TaskDetailViewModel,
        definition: TaskDefinition
    ) {

        self.viewModel = viewModel

        _name = State(
            initialValue: definition.name
        )

        _details = State(
            initialValue: definition.details
        )

    }

    var body: some View {

        NavigationStack {

            Form {

                Section("Tarefa") {

                    TextField(
                        "Nome",
                        text: $name
                    )

                    TextField(
                        "Descrição",
                        text: $details,
                        axis: .vertical
                    )
                    .lineLimit(3...6)

                }

            }
            .navigationTitle(
                "Editar tarefa"
            )
            .navigationBarTitleDisplayMode(
                .inline
            )
            .toolbar {

                ToolbarItem(
                    placement: .cancellationAction
                ) {

                    Button("Cancelar") {

                        dismiss()

                    }
                    .disabled(
                        viewModel.isSaving
                    )

                }

                ToolbarItem(
                    placement: .confirmationAction
                ) {

                    if viewModel.isSaving {

                        ProgressView()

                    } else {

                        Button("Salvar") {

                            Task {

                                let saved =
                                    await viewModel.update(
                                        name: name,
                                        details: details
                                    )

                                if saved {
                                    dismiss()
                                }

                            }

                        }
                        .disabled(
                            name
                                .trimmingCharacters(
                                    in: .whitespacesAndNewlines
                                )
                                .isEmpty
                        )

                    }

                }

            }

        }
        .alert(
            "Não foi possível salvar",
            isPresented: Binding(
                get: {
                    viewModel.actionError != nil
                },
                set: {
                    if !$0 {
                        viewModel.actionError = nil
                    }
                }
            )
        ) {

            Button("OK") {

                viewModel.actionError = nil

            }

        } message: {

            Text(
                viewModel.actionError ?? ""
            )

        }

    }

}


private struct UpcomingAssignmentRow: View {

    enum Position {
        case current
        case next
        case later
    }

    let assignment: UpcomingAssignment
    let position: Position
    let currentUserID: User.ID

    private var isCurrentUser: Bool {
        assignment.assignee?.id == currentUserID
    }

    var body: some View {

        HStack(
            spacing: DesignSystem.Spacing.medium
        ) {

            if let assignee = assignment.assignee {

                ResidentAvatar(
                    user: assignee
                )

            } else {

                Image(systemName: "person.crop.circle.badge.questionmark")
                    .font(.title2)
                    .foregroundStyle(.secondary)
                    .frame(width: 36, height: 36)

            }

            Text(name)
                .fontWeight(
                    isCurrentUser ? .semibold : .regular
                )
                .foregroundStyle(
                    assignment.assignee == nil
                        ? AnyShapeStyle(.secondary)
                        : AnyShapeStyle(.primary)
                )

            Spacer(
                minLength: DesignSystem.Spacing.small
            )

            trailing
                .foregroundStyle(.secondary)

        }
        .padding(
            .horizontal,
            DesignSystem.Spacing.large
        )
        .padding(
            .vertical,
            DesignSystem.Spacing.small
        )
        .accessibilityElement(
            children: .combine
        )

    }

    private var name: String {

        guard let assignee = assignment.assignee else {
            return "Sem responsável"
        }

        return isCurrentUser
            ? HouseOverviewText.you
            : ResidentNameFormatting.shortName(
                assignee.name
            )

    }

    @ViewBuilder
    private var trailing: some View {

        switch position {

        case .current:

            Text("Atual")

        case .next:

            Text("Próximo")

        case .later:

            Text(
                assignment.availableAt.formatted(
                    Date.FormatStyle(
                        locale: HouseOverviewText.appLocale
                    )
                    .weekday(.abbreviated)
                    .day()
                    .month(.abbreviated)
                )
            )

        }

    }

}

/// Textos das linhas de detalhes da tarefa.
enum TaskDetailText {

    /// "Semanal", "Mensal"...; intervalos maiores caem em "A cada 15 dias".
    static func recurrence(
        _ recurrence: RecurrencePolicy
    ) -> String {

        switch recurrence {

        case .none:

            return "Não se repete"

        case let .recurring(frequency, interval):

            guard interval == 1 else {

                return RoomDetailText.recurrence(
                    recurrence
                ) ?? ""

            }

            switch frequency {
            case .daily: return "Diária"
            case .weekly: return "Semanal"
            case .monthly: return "Mensal"
            case .yearly: return "Anual"
            }

        case let .weekly(periodicity):

            return RoomDetailText.cycleDuration(
                periodicity
            )

        }

    }

    /// "Semana passada", "Ontem", "Há 3 dias": a data relativa, com a primeira letra maiúscula.
    static func lastDone(
        _ date: Date
    ) -> String {

        let text = date.formatted(
            .relative(
                presentation: .named,
                unitsStyle: .wide
            )
            .locale(
                HouseOverviewText.appLocale
            )
        )

        return text.prefix(1).uppercased()
            + text.dropFirst()

    }

}

#Preview("Detalhes da tarefa") {

    let seed = MockSeed.make()

    let container = AppContainer(
        store: MockStore(state: seed)
    )

    let session = AppSession(
        currentUser: MockSeed.currentUser,
        currentHouse: MockSeed.house
    )

    let definition = seed.definitions.first {
        $0.roomID == MockSeed.kitchen.id
            && $0.recurrence.isRepeating
    }

    return TaskDetailView(
        viewModel: container.makeTaskDetailViewModel(
            taskDefinitionID: definition?.id ?? UUID(),
            session: session
        )
    )

}
