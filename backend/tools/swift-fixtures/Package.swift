// swift-tools-version: 6.0
import PackageDescription

// Gerador TEMPORÁRIO de fixtures de referência: roda cenários no GrupuxoDomain (Swift, a referência)
// e grava JSON em ../../test/fixtures. Não faz parte do app nem do pacote de domínio.
let package = Package(
    name: "swift-fixtures",
    platforms: [.macOS(.v14)],
    dependencies: [
        .package(path: "../../../grupuxo/Packages/GrupuxoDomain")
    ],
    targets: [
        .executableTarget(
            name: "swift-fixtures",
            dependencies: [.product(name: "GrupuxoDomain", package: "GrupuxoDomain")]
        )
    ],
    swiftLanguageModes: [.v5]
)
