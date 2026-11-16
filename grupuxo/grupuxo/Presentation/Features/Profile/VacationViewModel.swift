import Combine
import Foundation
import GrupuxoDomain

/// Modo férias em Ajustes: liga a partir do próximo ciclo e desliga quando a pessoa volta.
@MainActor
final class VacationViewModel: ObservableObject {

    @Published private(set) var status: VacationStatus = .off
    @Published private(set) var isSaving = false
    @Published var errorMessage: String?

    private let getVacation: GetVacationUseCase
    private let setVacation: SetVacationUseCase
    private let userID: User.ID
    private let houseID: House.ID

    init(getVacation: GetVacationUseCase, setVacation: SetVacationUseCase, userID: User.ID, houseID: House.ID) {
        self.getVacation = getVacation
        self.setVacation = setVacation
        self.userID = userID
        self.houseID = houseID
    }

    func load() async {
        do {
            status = try await getVacation(userID: userID, houseID: houseID)
        } catch is CancellationError {
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    /// Liga ou desliga; em falha, o interruptor volta ao que o servidor tem.
    func set(_ isOn: Bool) async {
        guard !isSaving, isOn != status.isOn else { return }
        isSaving = true
        defer { isSaving = false }
        do {
            status = try await setVacation(isOn, userID: userID, houseID: houseID)
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
            await load()
        }
    }

    /// O que o rodapé diz: quando começa, ou como voltar.
    func footer(now: Date = .now) -> String {
        guard status.isOn else {
            return String(localized: "Você sai dos rodízios a partir do próximo ciclo e volta quando desligar.")
        }
        if let startsAt = status.startsAt, status.hasNotStarted(at: now) {
            let day = startsAt.formatted(.dateTime.weekday(.wide).day().month(.wide).locale(HouseOverviewText.appLocale))
            return String(localized: "Você sai dos rodízios em \(day). Desligue para ficar.")
        }
        return String(localized: "Você está fora dos rodízios. Desligue para voltar a partir do próximo ciclo.")
    }
}
