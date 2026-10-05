// Valida a sintaxe de um arquivo de consulta M (Power Query) com o parser oficial da Microsoft.
// Uso: npm install --prefix <pasta> @microsoft/powerquery-parser
//      NODE_PATH=<pasta>/node_modules node verificar_m.js <arquivo.pq>
const PQP = require('@microsoft/powerquery-parser');
const fs = require('fs');

const texto = fs.readFileSync(process.argv[2], 'utf8');
(async () => {
  const tarefa = await PQP.TaskUtils.tryLexParse({ ...PQP.DefaultSettings }, texto);
  if (PQP.TaskUtils.isLexStageError(tarefa) || PQP.TaskUtils.isParseStageError(tarefa)) {
    console.log('ERRO:', JSON.stringify(tarefa.error?.message ?? tarefa.error, null, 1).slice(0, 3000));
    process.exit(1);
  }
  console.log('OK - sintaxe M válida; nós:', tarefa.nodeIdMapCollection?.astNodeById?.size);
})();
