import Foundation
import SwiftUI
import GrupuxoDomain

struct RoomCreationSheetView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.showToast) private var showToast

    @FocusState private var nameFocused: Bool
    @StateObject private var viewModel: RoomEditorViewModel

    private let existingRoomNames: [String]

    @State private var appearanceEdited = false
    @State private var showAppearance = false
    @State private var showDiscard = false

    @State private var cycleKind: RoomCreationCycleKind
    @State private var customWeeks: Int
    @State private var appearanceColor: RoomCreationColor

    private let nameLimit = 30

    init(
        viewModel: RoomEditorViewModel,
        existingRoomNames: [String] = []
    ) {
        _viewModel = StateObject(wrappedValue: viewModel)
        self.existingRoomNames = existingRoomNames

        let draft = viewModel.state.draft

        _cycleKind = State(
            initialValue: RoomCreationCycleKind(
                periodicity: draft.periodicity
            )
        )

        _customWeeks = State(
            initialValue: max(
                1,
                draft.periodicity.intervalWeeks
            )
        )

        _appearanceColor = State(
            initialValue: RoomCreationColor(
                domainColor: draft.color
            )
        )
    }

    // MARK: - Regras

    private var trimmedName: String {
        viewModel.state.draft.name
            .trimmingCharacters(in: .whitespaces)
    }

    private var isDuplicate: Bool {
        existingRoomNames.contains {
            $0.caseInsensitiveCompare(trimmedName)
                == .orderedSame
        }
    }

    private var canSave: Bool {
        !trimmedName.isEmpty
            && !isDuplicate
            && viewModel.canSave
    }

    private var isPrivate: Bool {
        viewModel.state.draft.visibility
            == .privateRoom
    }

    /// O alerta de descartar só existe se há algo preenchido.
    private var isDirty: Bool {
        !trimmedName.isEmpty
            || appearanceEdited
            || cycleKind != .weekly
            || viewModel.state.draft.responsibleCount != 1
            || isPrivate
    }

    /// Máximo de pessoas por ciclo = quem participa do cômodo.
    private var maxPeople: Int {
        let count = isPrivate
            ? max(
                viewModel.state.draft
                    .selectedParticipantIDs.count,
                1
            )
            : viewModel.residents.count

        return max(count, 1)
    }

    private var cycleSummary: String {
        let when: String

        // Singular e plural ficam nas variações do catálogo.
        switch cycleKind {
        case .weekly:
            when = String(localized: "A cada semana")

        case .biweekly:
            when = String(localized: "A cada 2 semanas")

        case .monthly:
            when = String(localized: "A cada mês")

        case .custom:
            when = customWeeks == 1
                ? String(localized: "A cada semana")
                : String(localized: "A cada \(customWeeks) semanas")
        }

        let people = viewModel.state.draft
            .responsibleCount

        return String(localized: "\(when), \(people) pessoas cuidam deste cômodo.")
    }

    // MARK: - Corpo

    var body: some View {
        NavigationStack {
            Form {
                nameSection
                rotationSection
                privacySection

                if case let .failure(_, message) =
                    viewModel.state {
                    Section {
                        Label(
                            message,
                            systemImage:
                                "exclamationmark.triangle"
                        )
                        .foregroundStyle(.red)
                    }
                }
            }
            .disabled(isSaving)
            .navigationTitle("Novo Cômodo")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                toolbarContent
            }
            .interactiveDismissDisabled(isDirty)
            .sheet(
                isPresented: $showAppearance
            ) {
                RoomCreationAppearancePickerView(
                    symbol: Binding(
                        get: {
                            viewModel.state.draft.icon
                        },
                        set: { newValue in
                            viewModel.updateDraft {
                                $0.icon = newValue
                            }
                        }
                    ),
                    color: $appearanceColor
                ) {
                    appearanceEdited = true

                    viewModel.updateDraft {
                        $0.color =
                            appearanceColor.domainColor
                    }
                }
            }
            .onChange(
                of: viewModel.state.draft.name
            ) { _, newValue in
                if newValue.count > nameLimit {
                    viewModel.updateDraft {
                        $0.name = String(
                            newValue.prefix(nameLimit)
                        )
                    }
                }

                applySuggestionIfNeeded()
            }
            .onChange(
                of: viewModel.state.draft
                    .selectedParticipantIDs
            ) { _, _ in
                clampPeoplePerCycle()
            }
            .onChange(
                of: viewModel.state.draft.visibility
            ) { _, _ in
                clampPeoplePerCycle()
            }
            .onChange(of: cycleKind) { _, _ in
                applyCycleToDraft()
            }
            .onChange(of: customWeeks) { _, _ in
                if cycleKind == .custom {
                    applyCycleToDraft()
                }
            }
            .onAppear {
                nameFocused = true
            }
        }
        .task {
            await viewModel.loadResidents()
            clampPeoplePerCycle()
        }
        .onChange(of: viewModel.state) { _, state in
            if case let .saved(room) = state {
                showToast(.created(String(localized: "Cômodo “\(room.name)” criado")))
                dismiss()
            }
        }
    }

    // MARK: - Seções

    private var nameSection: some View {
        Section {
            HStack(spacing: 16) {
                Button {
                    nameFocused = false
                    showAppearance = true
                } label: {
                    ZStack(
                        alignment: .bottomTrailing
                    ) {
                        Image(
                            systemName:
                                viewModel.state.draft.icon
                        )
                        .font(.title)
                        .foregroundStyle(.white)
                        .frame(
                            width: 60,
                            height: 60
                        )
                        .background(
                            appearanceColor.color
                                .gradient,
                            in: Circle()
                        )

                        Image(systemName: "pencil")
                            .font(
                                .system(
                                    size: 13,
                                    weight: .bold
                                )
                            )
                            .foregroundStyle(.white)
                            .frame(
                                width: 26,
                                height: 26
                            )
                            .background(
                                Color.accentColor,
                                in: Circle()
                            )
                            .overlay(
                                Circle()
                                    .strokeBorder(
                                        Color(
                                            .secondarySystemGroupedBackground
                                        ),
                                        lineWidth: 2
                                    )
                            )
                            .offset(x: 3, y: 3)
                    }
                }
                .buttonStyle(.plain)
                .accessibilityLabel(
                    "Ícone e cor do cômodo"
                )
                .accessibilityHint(
                    "Toque para alterar"
                )

                TextField(
                    "Nome do cômodo",
                    text: binding(\.name)
                )
                .focused($nameFocused)
                .textInputAutocapitalization(
                    .sentences
                )
                .submitLabel(.done)
            }
            .padding(.vertical, 4)
        } footer: {
            if isDuplicate {
                Text(
                    "Já existe um cômodo com esse nome."
                )
                .foregroundStyle(.red)
            }
        }
    }

    private var rotationSection: some View {
        Section {
            Picker(
                "Ciclo",
                selection: $cycleKind
            ) {
                ForEach(
                    RoomCreationCycleKind.allCases
                ) { kind in
                    Text(kind.title)
                        .tag(kind)
                }
            }
            .pickerStyle(.menu)

            if cycleKind == .custom {
                Picker(
                    "A cada",
                    selection: $customWeeks
                ) {
                    ForEach(
                        1...12,
                        id: \.self
                    ) { weeks in
                        Text(
                            weeks == 1
                                ? "1 semana"
                                : "\(weeks) semanas"
                        )
                        .tag(weeks)
                    }
                }
                .pickerStyle(.menu)
            }

            Stepper(
                value: responsibleCountBinding,
                in: 1...maxPeople
            ) {
                Text(
                    "Pessoas por ciclo: \(viewModel.state.draft.responsibleCount)"
                )
            }
        } header: {
            Text("Rodízio")
        } footer: {
            Text(cycleSummary)
                .contentTransition(.numericText())
                .animation(
                    .default,
                    value: cycleSummary
                )
        }
    }

    private var privacySection: some View {
        Section {
            Toggle(
                "Cômodo privado",
                isOn: privateRoomBinding.animation()
            )

            if isPrivate {
                NavigationLink {
                    participantsPicker
                } label: {
                    HStack {
                        Text("Participantes")

                        Spacer()

                        Text(participantsLabel)
                            .foregroundStyle(
                                .secondary
                            )
                    }
                }
            }
        } header: {
            Text("Privacidade")
        } footer: {
            Text(
                isPrivate
                    ? "Só os participantes veem este cômodo e entram no rodízio. Outros moradores podem pedir para entrar."
                    : "Todos os moradores participam do rodízio deste cômodo."
            )
        }
    }

    private var participantsLabel: String {
        let count = viewModel.state.draft
            .selectedParticipantIDs.count

        switch count {
        case 0:
            return String(localized: "Só você")

        default:
            return String(localized: "\(count) pessoas")
        }
    }

    // MARK: - Toolbar

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
            .disabled(isSaving)
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
                    "Ao descartar, nenhum cômodo será criado."
                )
            }
        }

        ToolbarItem(
            placement: .topBarTrailing
        ) {
            if isSaving {
                ProgressView("Criando cômodo")
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

    private var saveButton: some View {
        Button {
            nameFocused = false

            viewModel.updateDraft {
                $0.name = trimmedName
            }

            Task {
                await viewModel.save()
            }
        } label: {
            Image(systemName: "checkmark")
        }
        .accessibilityLabel("Criar cômodo")
        .accessibilityIdentifier("saveRoom")
    }


    // MARK: - Participantes

    private var participantsPicker: some View {
        List {
            Section {
                if viewModel.isLoadingResidents {
                    ProgressView(
                        "Carregando moradores…"
                    )
                } else if let error =
                    viewModel.residentsError {
                    Text(error)
                        .foregroundStyle(.secondary)

                    Button("Tentar novamente") {
                        Task {
                            await viewModel
                                .loadResidents()
                        }
                    }
                } else {
                    ForEach(
                        viewModel.residents
                    ) { person in
                        participantRow(person)
                    }
                }
            } footer: {
                Text(
                    "Você participa automaticamente. Os outros moradores podem pedir para entrar depois."
                )
            }
        }
        .navigationTitle("Participantes")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func participantRow(
        _ person: User
    ) -> some View {
        let selected = viewModel.state.draft
            .selectedParticipantIDs
            .contains(person.id)

        return Button {
            guard !viewModel.isCreator(person.id)
            else {
                return
            }

            viewModel.updateDraft {
                if selected {
                    $0.selectedParticipantIDs
                        .remove(person.id)
                } else {
                    $0.selectedParticipantIDs
                        .insert(person.id)
                }
            }
        } label: {
            HStack {
                Text(person.name)
                    .foregroundStyle(.primary)

                Spacer()

                if selected {
                    Image(
                        systemName: "checkmark"
                    )
                    .foregroundStyle(.tint)
                }
            }
        }
        .disabled(
            viewModel.isCreator(person.id)
        )
        .accessibilityAddTraits(
            selected ? .isSelected : []
        )
    }

    // MARK: - Sugestão automática

    private func applySuggestionIfNeeded() {
        guard !appearanceEdited else {
            return
        }

        guard let suggestion =
            RoomCreationAppearanceCatalog
                .suggestion(
                    for:
                        viewModel.state.draft.name
                )
        else {
            return
        }

        appearanceColor = suggestion.color

        viewModel.updateDraft {
            $0.icon = suggestion.symbol
            $0.color =
                suggestion.color.domainColor
            $0.category =
                suggestion.category
        }
    }

    // MARK: - Sincronização com o domínio

    private func applyCycleToDraft() {
        let intervalWeeks: Int

        switch cycleKind {
        case .weekly:
            intervalWeeks = 1

        case .biweekly:
            intervalWeeks = 2

        case .monthly:
            // O domínio atual representa a periodicidade
            // em semanas. A interface continua exibindo
            // exatamente "Mensal", como no design.
            intervalWeeks = 4

        case .custom:
            intervalWeeks = customWeeks
        }

        viewModel.updateDraft {
            $0.periodicity.intervalWeeks =
                intervalWeeks

            $0.periodicity
                .executionsPerPeriod = min(
                    $0.periodicity
                        .executionsPerPeriod,
                    intervalWeeks * 7
                )
        }
    }

    private func clampPeoplePerCycle() {
        let maximum = maxPeople

        viewModel.updateDraft {
            $0.responsibleCount = min(
                max(
                    1,
                    $0.responsibleCount
                ),
                maximum
            )
        }
    }

    // MARK: - Bindings

    private var responsibleCountBinding:
        Binding<Int> {
        Binding(
            get: {
                viewModel.state.draft
                    .responsibleCount
            },
            set: { value in
                viewModel.updateDraft {
                    $0.responsibleCount =
                        value
                }
            }
        )
    }

    private var privateRoomBinding:
        Binding<Bool> {
        Binding(
            get: {
                viewModel.state.draft
                    .visibility
                    == .privateRoom
            },
            set: { value in
                viewModel.updateDraft {
                    $0.visibility = value
                        ? .privateRoom
                        : .common
                }
            }
        )
    }

    private var isSaving: Bool {
        if case .saving = viewModel.state {
            return true
        }

        return false
    }

    private func binding<Value>(
        _ keyPath:
            WritableKeyPath<
                RoomDraft,
                Value
            >
    ) -> Binding<Value> {
        Binding(
            get: {
                viewModel.state.draft[
                    keyPath: keyPath
                ]
            },
            set: { value in
                viewModel.updateDraft {
                    $0[keyPath: keyPath] =
                        value
                }
            }
        )
    }
}

// MARK: - Ciclo do design

private enum RoomCreationCycleKind:
    String,
    CaseIterable,
    Identifiable {
    case weekly = "Semanal"
    case biweekly = "Quinzenal"
    case monthly = "Mensal"
    case custom = "Personalizado"

    var id: String {
        rawValue
    }

    var title: String {
        switch self {
        case .weekly: String(localized: "Semanal")
        case .biweekly: String(localized: "Quinzenal")
        case .monthly: String(localized: "Mensal")
        case .custom: String(localized: "Personalizado")
        }
    }

    init(periodicity: WeeklyPeriodicity) {
        switch periodicity.intervalWeeks {
        case 1:
            self = .weekly

        case 2:
            self = .biweekly

        case 4:
            self = .monthly

        default:
            self = .custom
        }
    }
}

// MARK: - Aparência do design

private enum RoomCreationColor:
    String,
    CaseIterable,
    Identifiable {
    case red
    case orange
    case yellow
    case green
    case mint
    case teal
    case cyan
    case indigo
    case purple
    case pink
    case brown
    case gray

    var id: String {
        rawValue
    }

    var color: Color {
        switch self {
        case .red:
            return .red

        case .orange:
            return .orange

        case .yellow:
            return .yellow

        case .green:
            return .green

        case .mint:
            return .mint

        case .teal:
            return .teal

        case .cyan:
            return .cyan

        case .indigo:
            return .indigo

        case .purple:
            return .purple

        case .pink:
            return .pink

        case .brown:
            return .brown

        case .gray:
            return .gray
        }
    }

    var domainColor: RoomColor {
        switch self {
        case .red:
            return .red

        case .orange:
            return .orange

        case .yellow:
            return .yellow

        case .green,
             .mint:
            return .green

        case .teal:
            return .teal

        case .cyan:
            return .cyan

        case .indigo:
            return .indigo

        case .purple:
            return .purple

        case .pink:
            return .pink

        case .brown:
            return .brown

        case .gray:
            return .gray
        }
    }

    init(domainColor: RoomColor) {
        switch domainColor {
        case .red:
            self = .red

        case .orange:
            self = .orange

        case .yellow:
            self = .yellow

        case .green:
            self = .green

        case .blue:
            // O protótipo original começa em cyan.
            self = .cyan

        case .purple:
            self = .purple

        case .brown:
            self = .brown

        case .gray:
            self = .gray

        case .pink:
            self = .pink

        case .teal:
            self = .teal

        case .indigo:
            self = .indigo

        case .cyan:
            self = .cyan
        }
    }
}

private enum RoomCreationAppearanceCatalog {
    static let symbols: [String] = [
        "house.fill",
        "bed.double.fill",
        "sofa.fill",
        "tv.fill",
        "desktopcomputer",
        "books.vertical.fill",
        "refrigerator.fill",
        "cabinet.fill",
        "spigot.fill",
        "cup.and.saucer.fill",
        "shower.fill",
        "toilet.fill",
        "washer.fill",
        "trash.fill",
        "sparkles",
        "paintbrush.pointed.fill",
        "car.fill"
    ]

    struct Suggestion {
        let symbol: String
        let color: RoomCreationColor
        let category: RoomCategory
    }

    static func suggestion(
        for name: String
    ) -> Suggestion? {
        let normalized = name.folding(
            options: [
                .diacriticInsensitive,
                .caseInsensitive
            ],
            locale: .current
        )

        let table:
            [
                (
                    keys: [String],
                    symbol: String,
                    color: RoomCreationColor,
                    category: RoomCategory
                )
            ] = [
                (
                    ["banheiro", "lavabo", "wc", "bath", "toilet", "restroom"],
                    "toilet.fill",
                    .cyan,
                    .bathroom
                ),
                (
                    ["cozinha", "copa", "kitchen", "pantry"],
                    "cup.and.saucer.fill",
                    .orange,
                    .kitchen
                ),
                (
                    ["sala", "estar", "living", "lounge"],
                    "sofa.fill",
                    .brown,
                    .livingRoom
                ),
                (
                    ["quarto", "suite", "bedroom"],
                    "bed.double.fill",
                    .indigo,
                    .bedroom
                ),
                (
                    ["garagem", "garage"],
                    "car.fill",
                    .gray,
                    .outdoor
                ),
                (
                    [
                        "lavanderia",
                        "area de servico",
                        "laundry"
                    ],
                    "washer.fill",
                    .teal,
                    .laundry
                ),
                (
                    [
                        "escritorio",
                        "home office",
                        "office",
                        "study"
                    ],
                    "desktopcomputer",
                    .cyan,
                    .office
                ),
                (
                    [
                        "varanda",
                        "quintal",
                        "jardim",
                        "balcony",
                        "porch",
                        "yard",
                        "garden",
                        "patio"
                    ],
                    "sparkles",
                    .green,
                    .outdoor
                ),
                (
                    ["lixo", "trash", "garbage"],
                    "trash.fill",
                    .gray,
                    .other
                )
            ]

        guard let match = table.first(
            where: { entry in
                entry.keys.contains {
                    normalized.contains($0)
                }
            }
        ) else {
            return nil
        }

        return Suggestion(
            symbol: match.symbol,
            color: match.color,
            category: match.category
        )
    }
}

// MARK: - Seleção de aparência

private struct RoomCreationAppearancePickerView:
    View {
    @Environment(\.dismiss) private var dismiss

    @Binding var symbol: String
    @Binding var color:
        RoomCreationColor

    let onChange: () -> Void

    private let columns: [GridItem] =
        Array(
            repeating:
                GridItem(
                    .flexible(),
                    spacing: 12
                ),
            count: 6
        )

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 24) {
                    previewCircle
                    colorBlock
                    symbolBlock
                }
                .padding()
            }
            .background(
                Color(
                    .systemGroupedBackground
                )
            )
            .navigationTitle("Aparência")
            .navigationBarTitleDisplayMode(
                .inline
            )
            .toolbar {
                ToolbarItem(
                    placement:
                        .confirmationAction
                ) {
                    Button("OK") {
                        dismiss()
                    }
                }
            }
        }
        .presentationDetents(
            [.medium, .large]
        )
    }

    private var previewCircle: some View {
        Image(systemName: symbol)
            .font(.system(size: 40))
            .foregroundStyle(.white)
            .frame(
                width: 88,
                height: 88
            )
            .background(
                color.color.gradient,
                in: Circle()
            )
            .padding(.top, 8)
    }

    private var colorBlock: some View {
        block(title: "Cor") {
            LazyVGrid(
                columns: columns,
                spacing: 12
            ) {
                ForEach(
                    RoomCreationColor.allCases
                ) { option in
                    RoomCreationColorSwatch(
                        color:
                            option.color,
                        isSelected:
                            option == color
                    ) {
                        color = option
                        onChange()
                    }
                }
            }
        }
    }

    private var symbolBlock: some View {
        block(title: "Ícone") {
            LazyVGrid(
                columns: columns,
                spacing: 12
            ) {
                ForEach(
                    RoomCreationAppearanceCatalog
                        .symbols,
                    id: \.self
                ) { option in
                    RoomCreationSymbolSwatch(
                        symbol: option,
                        tint: color.color,
                        isSelected:
                            option == symbol
                    ) {
                        symbol = option
                        onChange()
                    }
                }
            }
        }
    }

    private func block<Content: View>(
        title: LocalizedStringKey,
        @ViewBuilder
        content: () -> Content
    ) -> some View {
        VStack(
            alignment: .leading,
            spacing: 8
        ) {
            Text(title)
                .font(.footnote)
                .foregroundStyle(.secondary)
                .padding(.leading, 4)

            content()
                .padding()
                .background(
                    RoundedRectangle(
                        cornerRadius: 20
                    )
                    .fill(
                        Color(
                            .secondarySystemGroupedBackground
                        )
                    )
                )
        }
    }
}

// MARK: - Itens da grade

private struct RoomCreationColorSwatch:
    View {
    let color: Color
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Circle()
                .fill(color)
                .frame(
                    width: 44,
                    height: 44
                )
                .overlay(ring)
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(
            isSelected
                ? .isSelected
                : []
        )
    }

    @ViewBuilder
    private var ring: some View {
        if isSelected {
            Circle()
                .strokeBorder(
                    Color.primary
                        .opacity(0.5),
                    lineWidth: 3
                )
                .padding(-4)
        }
    }
}

private struct RoomCreationSymbolSwatch:
    View {
    let symbol: String
    let tint: Color
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.title3)
                .foregroundStyle(
                    isSelected
                        ? Color.white
                        : Color.primary
                )
                .frame(
                    width: 44,
                    height: 44
                )
                .background(
                    Circle()
                        .fill(fillColor)
                )
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(
            isSelected
                ? .isSelected
                : []
        )
    }

    private var fillColor: Color {
        isSelected
            ? tint
            : Color(
                .tertiarySystemFill
            )
    }
}
