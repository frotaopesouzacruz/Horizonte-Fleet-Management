section Section1;

shared Pneus_Rodopar10 = let
    // =====================================================================================
    // GESTÃO DE PNEUS - HORIZONTE | consulta da base oficial Rodopar 10
    // Para trocar o arquivo de origem, altere SOMENTE o texto da etapa CaminhoArquivo:
    //   - arquivo local:  "C:\Pasta\Rodopar 10.xlsx"
    //   - SharePoint:     link direto do arquivo (https://...xlsx)
    // =====================================================================================
    CaminhoArquivo = "{{CAMINHO_ARQUIVO}}",
    DataHoraAtualizacao = DateTime.LocalNow(),

    // ---------- funções de padronização ----------
    fnTexto = (v as any) as nullable text =>
        if v = null then null
        else let t = Text.Trim(Text.Clean(Text.From(v))) in if t = "" then null else t,
    fnNumero = (v as any) as nullable number =>
        if v = null then null
        else if v is number then v
        else if v is datetime or v is date then Number.From(v)
        else let t = Text.Trim(Text.Replace(Text.From(v), ",", ".")) in
            if t = "" then null else try Number.FromText(t, "en-US") otherwise null,
    fnInteiro = (v as any) as nullable number =>
        let n = fnNumero(v) in if n = null then null else Number.Round(n, 0),
    fnData = (v as any) as nullable datetime =>
        if v = null then null
        else if v is datetime then v
        else if v is date then DateTime.From(v)
        else if v is number then DateTime.From(v)
        else try DateTime.From(Text.Trim(Text.From(v)), "pt-BR") otherwise null,
    fnSoData = (v as any) as nullable date =>
        let d = fnData(v) in if d = null then null else Date.From(d),
    fnMedida = (v as any) as nullable text =>
        let t = fnTexto(v) in if t = null then null else Text.Replace(Text.Remove(Text.Upper(t), {" "}), "R", " R"),
    fnMaiusculo = (v as any) as nullable text =>
        let t = fnTexto(v) in if t = null then null else Text.Upper(t),
    fnFrota = (v as any) as nullable text =>
        if v = null then null
        else if v is number then Text.From(Number.Round(v, 0))
        else fnMaiusculo(v),
    fnLog = (r as record) as nullable text =>
        let
            itens = {
                if r[Calibragem] is datetime or r[Calibragem] is date then "Calibragem convertida de data para número" else null,
                if r[#"Dimensão"] <> null and fnMedida(r[#"Dimensão"]) <> Text.From(r[#"Dimensão"]) then "Medida padronizada" else null,
                if r[#"Situação Pneu"] <> null and fnMaiusculo(r[#"Situação Pneu"]) <> Text.From(r[#"Situação Pneu"]) then "Situação padronizada" else null,
                if List.AnyTrue(List.Transform({r[#"Menor Milimetragem"], r[#"Sulco 1"], r[#"Sulco 2"], r[#"Sulco 3"], r[#"Sulco 4"], r[#"N. Vida"]}, each _ is text)) then "Número armazenado como texto convertido" else null,
                if List.AnyTrue(List.Transform({r[Marca], r[#"Modelo Pneu"], r[#"Posição"], r[Status], r[#"N. Frota"]}, each _ is text and Text.Trim(_) <> _)) then "Espaços extras removidos" else null
            },
            validos = List.RemoveNulls(itens)
        in
            if List.IsEmpty(validos) then null else Text.Combine(validos, "; "),

    // ---------- leitura ----------
    Caminho = Text.Trim(CaminhoArquivo),
    Binario = if Text.StartsWith(Text.Lower(Caminho), "http") then Web.Contents(Caminho) else File.Contents(Caminho),
    Pasta = Excel.Workbook(Binario, null, true),
    Planilhas = Table.SelectRows(Pasta, each [Kind] = "Sheet"),
    Dados = if List.Contains(Planilhas[Name], "Planilha1") then Planilhas{[Name = "Planilha1"]}[Data] else Planilhas{0}[Data],
    Cabecalhos = Table.PromoteHeaders(Dados, [PromoteAllScalars = true]),
    NomesPadronizados = Table.TransformColumnNames(Cabecalhos, (n) =>
        Text.Combine(List.Select(Text.Split(Text.Replace(Text.Replace(Text.Trim(n), "#(cr)", " "), "#(lf)", " "), " "), each _ <> ""), " ")),
    ColunasRodopar = {"N.Fogo", "Filial Pneu", "Cód Unidade", "Cód Custo", "Data Compra", "Situação Pneu", "N. Frota",
        "Filial Frota", "Marca", "Modelo Pneu", "Dimensão", "Posição", "Menor Milimetragem", "Sulco 1", "Sulco 2", "Sulco 3",
        "Sulco 4", "Dt. Medição", "Calibragem", "Dt. Calibragem", "Km Rodado", "Km Real", "Dot", "N. Vida", "Condição",
        "Classificação", "Status", "Data Cadastro", "Número De Série", "Usuário De Inclusão", "Usuário Última Alteração",
        "Data Última Alteração", "Desenho", "Borracha"},
    Selecionadas = Table.SelectColumns(NomesPadronizados, ColunasRodopar, MissingField.UseNull),
    SemLinhasVazias = Table.SelectRows(Selecionadas, each List.NonNullCount(List.Transform(Record.FieldValues(_),
        each if _ is text and Text.Trim(_) = "" then null else _)) > 0),

    // ---------- tratamento ----------
    ComLog = Table.AddColumn(SemLinhasVazias, "Tratamento Aplicado", each fnLog(_), type nullable text),
    Tratada = Table.TransformColumns(ComLog, {
        {"N.Fogo", fnInteiro, Int64.Type}, {"Filial Pneu", fnInteiro, Int64.Type}, {"Cód Unidade", fnInteiro, Int64.Type},
        {"Cód Custo", fnInteiro, Int64.Type}, {"Data Compra", fnSoData, type nullable date},
        {"Situação Pneu", fnMaiusculo, type nullable text}, {"N. Frota", fnFrota, type nullable text},
        {"Filial Frota", fnInteiro, Int64.Type}, {"Marca", fnTexto, type nullable text}, {"Modelo Pneu", fnTexto, type nullable text},
        {"Dimensão", fnMedida, type nullable text}, {"Posição", fnMaiusculo, type nullable text},
        {"Menor Milimetragem", fnNumero, type nullable number}, {"Sulco 1", fnNumero, type nullable number},
        {"Sulco 2", fnNumero, type nullable number}, {"Sulco 3", fnNumero, type nullable number},
        {"Sulco 4", fnNumero, type nullable number}, {"Dt. Medição", fnData, type nullable datetime},
        {"Calibragem", fnNumero, type nullable number}, {"Dt. Calibragem", fnData, type nullable datetime},
        {"Km Rodado", fnNumero, type nullable number}, {"Km Real", fnNumero, type nullable number},
        {"Dot", fnInteiro, Int64.Type}, {"N. Vida", fnInteiro, Int64.Type}, {"Condição", fnTexto, type nullable text},
        {"Classificação", fnTexto, type nullable text}, {"Status", fnTexto, type nullable text},
        {"Data Cadastro", fnData, type nullable datetime}, {"Número De Série", fnNumero, type nullable number},
        {"Usuário De Inclusão", fnTexto, type nullable text}, {"Usuário Última Alteração", fnTexto, type nullable text},
        {"Data Última Alteração", fnData, type nullable datetime}, {"Desenho", fnTexto, type nullable text},
        {"Borracha", fnTexto, type nullable text}}),
    ComAtualizacao = Table.AddColumn(Tratada, "Atualizado em", each DataHoraAtualizacao, type datetime),
    ComFonte = Table.AddColumn(ComAtualizacao, "Arquivo Fonte", each Caminho, type text),
    Ordenada = Table.Sort(ComFonte, {{"N.Fogo", Order.Ascending}}),
    Resultado = Table.SelectColumns(Ordenada, ColunasRodopar & {"Tratamento Aplicado", "Atualizado em", "Arquivo Fonte"})
in
    Resultado;
