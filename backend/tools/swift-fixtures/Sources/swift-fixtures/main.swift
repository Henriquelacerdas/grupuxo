import Foundation

let args = CommandLine.arguments
guard args.count >= 3 else {
    print("uso: swift-fixtures <dates|hungarian|...> <diretório-de-saída>")
    exit(2)
}
let outDir = args[2]
try FileManager.default.createDirectory(atPath: outDir, withIntermediateDirectories: true)
switch args[1] {
case "dates": generateDates(outDir: outDir)
case "hungarian": generateHungarian(outDir: outDir)
case "engine": generateDistributionEngine(outDir: outDir)
case "scheduling": generateScheduling(outDir: outDir)
case "policies": generatePolicies(outDir: outDir)
case "fairness": generateFairnessAndLoad(outDir: outDir)
case "optimizer": generateHouseQueueOptimizer(outDir: outDir)
default:
    print("comando desconhecido: \(args[1])")
    exit(2)
}
