import SwiftUI
import GrupuxoDomain

struct SporadicTasksView: View {

    @Environment(\.dynamicTypeSize)
    private var dynamicTypeSize

    @Environment(\.dismiss)
    private var dismiss

    @StateObject
    private var viewModel: SporadicTasksViewModel

    @State
    private var itemPendingDeletion: SporadicTaskCardItem?

    @State
    private var pendingChangesAlert: PendingChangesAlert?

    private let onEditTask: (TaskDefinition.ID) -> Void

    private enum PendingChangesAlert: Identifiable {

        case discardAndExit
        case confirmRelease

        var id: Int {

            switch self {

            case .discardAndExit:
                return 0

            case .confirmRelease:
                return 1
            }
        }
    }

    init(
        viewModel: SporadicTasksViewModel,
        onEditTask: @escaping (TaskDefinition.ID) -> Void = { _ in }
    ) {

        _viewModel = StateObject(
            wrappedValue: viewModel
        )

        self.onEditTask = onEditTask
    }

    var body: some View {

        Group {

            switch viewModel.state {

            case .idle, .loading:

                ProgressView(
                    "Carregando tarefas…"
                )

            case let .content(items):

                tasksContent(items)

            case .empty:

                emptyContent

            case let .failure(message):

                ContentUnavailableView(
                    "Não foi possível carregar",
                    systemImage:
                        "exclamationmark.triangle",
                    description: Text(message)
                )
            }
        }
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .navigationBarBackButtonHidden(true)
        .toolbar {

            ToolbarItem(
                placement: .cancellationAction
            ) {

                Button {

                    closeTapped()

                } label: {

                    Image(
                        systemName: "xmark"
                    )
                }
                .accessibilityLabel("Fechar")
            }

            if viewModel.hasPendingChanges {

                ToolbarItem(
                    placement: .confirmationAction
                ) {

                    Button {

                        confirmTapped()

                    } label: {

                        Image(
                            systemName: "checkmark"
                        )
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(
                        viewModel.isSavingChanges
                    )
                    .accessibilityLabel(
                        "Confirmar alterações"
                    )
                }
            }
        }
        .background(
            Color(
                uiColor:
                    .systemGroupedBackground
            )
            .ignoresSafeArea()
        )
        .task {

            await viewModel.load()
        }
        .refreshable {

            await viewModel.load()
        }
        .alert(
            "Não foi possível realizar a ação",
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
        .alert(
            "Excluir Tarefa Única?",
            isPresented: Binding(
                get: {
                    itemPendingDeletion != nil
                },
                set: { isPresented in

                    if !isPresented {
                        itemPendingDeletion = nil
                    }
                }
            ),
            presenting: itemPendingDeletion
        ) { item in

            Button(
                "Cancelar",
                role: .cancel
            ) {

                itemPendingDeletion = nil
            }

            Button(
                "Excluir",
                role: .destructive
            ) {

                let taskDefinitionID =
                    item.task.definition.id

                itemPendingDeletion = nil

                Task {

                    await viewModel.delete(
                        taskDefinitionID
                    )
                }
            }

        } message: { item in

            Text(
                "A tarefa \"\(item.task.definition.name)\" será excluída para todos os moradores."
            )
        }
        .alert(
            item: $pendingChangesAlert
        ) { alert in

            switch alert {

            case .discardAndExit:

                return Alert(
                    title: Text(
                        "Descartar alterações?"
                    ),
                    message: Text(
                        "Ao descartar as alterações nenhuma Tarefa Única será atribuída a você."
                    ),
                    dismissButton:
                        .destructive(
                            Text("Descartar")
                        ) {

                            viewModel
                                .discardPendingAssignmentChanges()

                            dismiss()
                        }
                )

            case .confirmRelease:

                return Alert(
                    title: Text(
                        "Descartar alterações?"
                    ),
                    message: Text(
                        "Ao descartar as alterações nenhuma Tarefa Única será atribuída a você."
                    ),
                    dismissButton:
                        .destructive(
                            Text("Descartar")
                        ) {

                            Task {

                                let succeeded =
                                    await viewModel
                                        .confirmPendingAssignmentChanges()

                                if succeeded {
                                    dismiss()
                                }
                            }
                        }
                )
            }
        }
    }

    private func closeTapped() {

        /*
         Se o usuário escolheu uma nova Tarefa Única
         e tenta sair pelo X antes de confirmar,
         mostramos o aviso do Figma.
         */
        if viewModel.hasPendingClaims {

            pendingChangesAlert =
                .discardAndExit

            return
        }

        /*
         Sem nova atribuição pendente, qualquer
         alteração local é abandonada e a tela fecha.
         */
        viewModel
            .discardPendingAssignmentChanges()

        dismiss()
    }

    private func confirmTapped() {

        /*
         Se o usuário marcou "Desfazer" em uma tarefa
         que já estava atribuída a ele, o aviso aparece
         quando ele tenta confirmar.
         */
        if viewModel.hasPendingReleases {

            pendingChangesAlert =
                .confirmRelease

            return
        }

        /*
         Se houver apenas novas atribuições,
         confirma normalmente.
         */
        Task {

            let succeeded =
                await viewModel
                    .confirmPendingAssignmentChanges()

            if succeeded {
                dismiss()
            }
        }
    }

    // MARK: - Content

    private func tasksContent(
        _ items: [SporadicTaskCardItem]
    ) -> some View {

        ScrollView {

            LazyVStack(
                spacing:
                    DesignSystem.Spacing.large
            ) {

                hero(
                    pendingCount: items.count
                )

                informationText

                ForEach(items) { item in

                    taskCard(item)
                }
            }
            .frame(
                maxWidth: .infinity
            )
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

    private var emptyContent: some View {

        ScrollView {

            VStack(
                spacing:
                    DesignSystem.Spacing.large
            ) {

                hero(
                    pendingCount: 0
                )

                informationText

                ContentUnavailableView(
                    "Nenhuma Tarefa Única",
                    systemImage: "flag",
                    description: Text(
                        "Quando uma Tarefa Única for criada, ela aparecerá aqui."
                    )
                )
                .padding(.top, 8)
            }
            .frame(
                maxWidth: .infinity
            )
            .padding(
                .horizontal,
                DesignSystem.Spacing.large
            )
        }
    }

    // MARK: - Hero

    private func hero(
        pendingCount: Int
    ) -> some View {

        VStack(
            spacing:
                DesignSystem.Spacing.small
        ) {

            ZStack {

                Circle()
                    .fill(
                        Color(
                            uiColor:
                                .secondarySystemGroupedBackground
                        )
                    )
                    .frame(
                        width: 100,
                        height: 100
                    )

                Image(
                    systemName: "flag.fill"
                )
                .font(
                    .system(
                        size: 44,
                        weight: .regular
                    )
                )
                .foregroundStyle(.red)
                .accessibilityHidden(true)
            }
            .padding(
                .bottom,
                DesignSystem.Spacing.small
            )

            Text("Tarefas Únicas")
                .font(
                    .largeTitle.bold()
                )
                .multilineTextAlignment(
                    .center
                )
                .fixedSize(
                    horizontal: false,
                    vertical: true
                )

            Text(
                pendingText(
                    pendingCount
                )
            )
            .font(.body)
            .multilineTextAlignment(
                .center
            )
        }
        .frame(
            maxWidth: .infinity
        )
        .padding(
            .top,
            DesignSystem.Spacing.large
        )
    }

    private var informationText: some View {

        Label {

            Text(
                "Cada Tarefa Única realizada pula sua vez na próxima Tarefa Extra."
            )

        } icon: {

            Image(
                systemName: "info.circle"
            )
        }
        .font(.footnote)
        .foregroundStyle(.secondary)
        .frame(
            maxWidth: .infinity,
            alignment: .leading
        )
        .fixedSize(
            horizontal: false,
            vertical: true
        )
    }

    // MARK: - Task card

    private func taskCard(
        _ item: SporadicTaskCardItem
    ) -> some View {

        VStack(
            alignment: .leading,
            spacing:
                DesignSystem.Spacing.small
        ) {

            cardHeader(item)

            primaryAction(item)

            if viewModel
                .wasCreatedByCurrentUser(item) {

                editAction(item)

                deleteAction(item)
            }
        }
        .padding(
            DesignSystem.Spacing.large
        )
        .frame(
            maxWidth: .infinity,
            alignment: .leading
        )
        .background {

            RoundedRectangle(
                cornerRadius: 24,
                style: .continuous
            )
            .fill(
                Color(
                    uiColor:
                        .secondarySystemGroupedBackground
                )
            )
        }
    }

    @ViewBuilder
    private func cardHeader(
        _ item: SporadicTaskCardItem
    ) -> some View {

        let layout: AnyLayout =
            dynamicTypeSize.isAccessibilitySize
            ? AnyLayout(
                VStackLayout(
                    alignment: .leading,
                    spacing:
                        DesignSystem.Spacing.small
                )
            )
            : AnyLayout(
                HStackLayout(
                    alignment: .center,
                    spacing:
                        DesignSystem.Spacing.small
                )
            )

        layout {

            roomIcon(item.room)

            VStack(
                alignment: .leading,
                spacing:
                    DesignSystem.Spacing.extraSmall
            ) {

                Text(
                    item.task.definition.name
                )
                .font(
                    .title3.weight(
                        .semibold
                    )
                )
                .foregroundStyle(
                    .primary
                )
                .fixedSize(
                    horizontal: false,
                    vertical: true
                )

                roomLabel(item.room)

                creatorLabel(item)
            }
            .frame(
                maxWidth: .infinity,
                alignment: .leading
            )
        }
        .frame(
            maxWidth: .infinity,
            alignment: .leading
        )
    }

    // MARK: - Room appearance

    private func roomIcon(
        _ room: Room
    ) -> some View {

        ZStack {

            Circle()
                .fill(
                    color(
                        for: room.color
                    )
                )
                .frame(
                    width: 60,
                    height: 60
                )

            Image(
                systemName: room.icon
            )
            .font(
                .system(
                    size: 24,
                    weight: .semibold
                )
            )
            .foregroundStyle(.white)
            .accessibilityHidden(true)
        }
        .frame(
            width: 60,
            height: 60
        )
    }

    private func roomLabel(
        _ room: Room
    ) -> some View {

        HStack(
            alignment: .firstTextBaseline,
            spacing:
                DesignSystem.Spacing.small
        ) {

            Image(
                systemName: "house"
            )
            .accessibilityHidden(true)

            (
                Text("em ")
                +
                Text(room.name)
                    .bold()
            )
            .fixedSize(
                horizontal: false,
                vertical: true
            )
        }
        .font(.body)
    }

    @ViewBuilder
    private func creatorLabel(
        _ item: SporadicTaskCardItem
    ) -> some View {

        if viewModel
            .wasCreatedByCurrentUser(item) {

            (
                Text(
                    "Adicionado por "
                )
                +
                Text("Você")
                    .bold()
            )
            .font(.body)
            .foregroundStyle(
                .secondary
            )

        } else if let creator =
                    item.creator {

            (
                Text(
                    "Adicionado por "
                )
                +
                Text(creator.name)
                    .bold()
            )
            .font(.body)
            .foregroundStyle(
                .secondary
            )
        }
    }

    // MARK: - Actions

    private func primaryAction(
        _ item: SporadicTaskCardItem
    ) -> some View {

        Button {

            Task {

                if viewModel.canClaim(
                    item.task
                ) {

                    await viewModel.claim(
                        item.task.id
                    )

                } else if viewModel
                    .canRelease(
                        item.task
                    ) {

                    await viewModel.release(
                        item.task.id
                    )
                }
            }

        } label: {

            Text(
                primaryActionTitle(
                    item.task
                )
            )
            .font(
                .callout.weight(
                    .semibold
                )
            )
            .frame(
                maxWidth: .infinity
            )
        }
        .buttonStyle(
            .borderedProminent
        )
        .controlSize(.regular)
        .disabled(
            viewModel.isSavingChanges
                || (
                    !viewModel.canClaim(
                        item.task
                    )
                    && !viewModel.canRelease(
                        item.task
                    )
                )
        )
    }

    private func editAction(
        _ item: SporadicTaskCardItem
    ) -> some View {

        Button {

            onEditTask(
                item.task.definition.id
            )

        } label: {

            Text("Editar")
                .font(
                    .callout.weight(
                        .semibold
                    )
                )
                .frame(
                    maxWidth: .infinity
                )
        }
        .buttonStyle(.bordered)
        .controlSize(.regular)
    }

    private func deleteAction(
        _ item: SporadicTaskCardItem
    ) -> some View {

        Button(
            role: .destructive
        ) {

            itemPendingDeletion = item

        } label: {

            Text("Excluir")
                .font(
                    .callout.weight(
                        .semibold
                    )
                )
                .frame(
                    maxWidth: .infinity
                )
        }
        .buttonStyle(.bordered)
        .controlSize(.regular)
        .tint(.red)
        .accessibilityLabel(
            "Excluir \(item.task.definition.name)"
        )
    }

    // MARK: - Helpers

    private func pendingText(
        _ count: Int
    ) -> String {

        count == 1
            ? "1 tarefa pendente"
            : "\(count) tarefas pendentes"
    }

    private func primaryActionTitle(
        _ item: TaskItem
    ) -> String {

        if viewModel.canRelease(
            item
        ) {

            return "Desfazer"
        }

        return "Adicionar a \"Minhas Tarefas\""
    }

    private func color(
        for roomColor: RoomColor
    ) -> Color {

        switch roomColor {

        case .red:
            return .red

        case .orange:
            return .orange

        case .yellow:
            return .yellow

        case .green:
            return .green

        case .blue:
            return .blue

        case .purple:
            return .purple

        case .brown:
            return .brown

        case .gray:
            return .gray

        case .pink:
            return .pink
        }
    }
}
