/**
 * Teste de carga REAL com k6 (https://k6.io) — 50 usuários simultâneos
 * usando o app contra um projeto Supabase.
 *
 * ⚠️ Rode de preferência num projeto de TESTE (cópia). Se rodar em produção:
 *    fora do horário de trabalho, e depois execute testes-carga/limpar-dados-teste.sql.
 *    Tudo que o teste grava usa a peça "TESTE-CARGA" e operador "Teste de carga".
 *
 * Variáveis (nada de senha no código):
 *   SUPABASE_URL      https://<projeto>.supabase.co
 *   SUPABASE_ANON_KEY chave pública (a mesma do app)
 *   USUARIOS          "email1:senha1,email2:senha2"  (usuários de teste com papel produção;
 *                     pode ser 1 só — várias sessões simultâneas são permitidas)
 *   VUS               usuários simultâneos (padrão 50)
 *   DURACAO           tempo com a carga máxima (padrão 5m)
 *
 * Exemplo:
 *   k6 run -e SUPABASE_URL=... -e SUPABASE_ANON_KEY=... -e USUARIOS="a@x:senha" testes-carga/k6-50-usuarios.js
 */
import http from "k6/http";
import { check, sleep, group } from "k6";

const URL = __ENV.SUPABASE_URL;
const KEY = __ENV.SUPABASE_ANON_KEY;
const VUS = parseInt(__ENV.VUS || "50", 10);

export const options = {
  scenarios: {
    uso_normal: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "1m", target: VUS },              // chegando ao trabalho
        { duration: __ENV.DURACAO || "5m", target: VUS }, // todos usando
        { duration: "30s", target: 0 },
      ],
      gracefulRampDown: "30s",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],                   // menos de 1% de erro
    "http_req_duration{tipo:leitura}": ["p(95)<1500"],
    "http_req_duration{tipo:lancamento}": ["p(95)<2000"],
    "http_req_duration{tipo:relatorio}": ["p(95)<4000"],
  },
};

function hoje() { return new Date().toISOString().slice(0, 10); }

// Login uma vez por usuário (evita limite de logins do Supabase Auth).
export function setup() {
  if (!URL || !KEY || !__ENV.USUARIOS) throw new Error("Defina SUPABASE_URL, SUPABASE_ANON_KEY e USUARIOS.");
  const tokens = [];
  for (const par of __ENV.USUARIOS.split(",")) {
    const i = par.indexOf(":");
    const res = http.post(`${URL}/auth/v1/token?grant_type=password`,
      JSON.stringify({ email: par.slice(0, i).trim(), password: par.slice(i + 1) }),
      { headers: { apikey: KEY, "Content-Type": "application/json" } });
    if (res.status !== 200) throw new Error(`Login falhou (${res.status}) para um dos usuários de teste.`);
    tokens.push(res.json("access_token"));
  }
  return { tokens };
}

export default function (data) {
  const token = data.tokens[(__VU - 1) % data.tokens.length];
  const h = { headers: { apikey: KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json" } };
  const get = (path, tipo) => http.get(`${URL}/rest/v1/${path}`, Object.assign({ tags: { tipo } }, h));
  const rpc = (fn, body, tipo) => http.post(`${URL}/rest/v1/rpc/${fn}`, JSON.stringify(body), Object.assign({ tags: { tipo } }, h));

  group("abrir Diário", () => {
    const r = [
      get("maquinas_producao?select=id,codigo,nome,status", "leitura"),
      get("produtos_producao?select=codigo,descricao,pecas_por_hora&ativo=eq.true", "leitura"),
      get("tipo_parada_producao?select=id,nome,categoria&ativo=eq.true", "leitura"),
      get(`apontamentos_producao?select=id,maquina_codigo,produto,quantidade,horas_planejadas,operador,created_at&data_apontamento=eq.${hoje()}`, "leitura"),
      get("tempo_peca_padrao?select=produto,maquina,pecas_hora,amostras", "leitura"),
    ];
    r.forEach(x => check(x, { "leitura ok": y => y.status === 200 }));
  });
  sleep(3 + Math.random() * 5); // operador preenchendo

  if (Math.random() < 0.4) {
    group("salvar lançamento", () => {
      const res = rpc("criar_apontamento_ppi51", {
        p_data: hoje(), p_turno: "Dia inteiro", p_maquina: "TESTE", p_equipamento: "TESTE",
        p_produto: "TESTE-CARGA", p_descricao_produto: "Teste de carga", p_qtde_por_hora: 0,
        p_horas_planejadas: 8, p_qtde_plan_disp: 100, p_qtde_produzida: 100, p_horario_inicio: 0, p_horario_fim: 24,
        p_cycle_time_min: null, p_lead_time_horas: 8, p_lote: "", p_lote_mp: "", p_descricao_mp: "",
        p_comprimento_mm: null, p_consumo_mp_metros: null, p_operador: "Teste de carga",
        p_paradas: [{ tipo_id: 1, tipo_nome: "Refeição", duracao_horas: 1 }], p_refugos: [],
      }, "lancamento");
      check(res, { "lançamento salvo": r => r.status === 200 && r.json("ok") === true });
    });
  }

  if (Math.random() < 0.15) {
    group("abrir Desempenho", () => {
      const ano = new Date().getFullYear(), mes = new Date().getMonth() + 1;
      const r = [
        rpc("calcular_oee", { p_data_ini: `${ano}-${mes <= 6 ? "01" : "07"}-01`, p_data_fim: hoje() }, "relatorio"),
        rpc("resumo_mensal_producao", { p_mes: mes, p_ano: ano }, "relatorio"),
        get(`tempo_peca_mensal?select=produto,mes,pecas,horas_produtivas&mes=gte.${ano}-01-01`, "relatorio"),
      ];
      r.forEach(x => check(x, { "relatório ok": y => y.status === 200 }));
    });
  }
  sleep(5 + Math.random() * 10); // tempo até a próxima ação
}
