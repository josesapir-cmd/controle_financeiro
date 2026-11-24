import "server-only";

import {
  checkRecoveryCode,
  codigoValido,
  consumirCodigo,
  hasCredentials,
} from "./credentials";
import type { Papel } from "./config";
import { currentSession } from "./session";

/**
 * Registro de passkey.
 *
 * Cinco caminhos permitidos, e apenas eles:
 *   1. bootstrap — nao ha nenhuma credencial ainda;
 *   2. adicionar dispositivo — com sessao do dono aberta;
 *   3. adicionar dispositivo — com o codigo de 10 minutos;
 *   4. recuperacao — com o codigo guardado offline;
 *   5. assistente — com o convite que o dono gerou.
 *
 * Os quatro primeiros registram passkey de DONO; o quinto, de assistente.
 *
 * A janela de bootstrap se fecha sozinha na primeira credencial gravada. Nao
 * depende de o dono lembrar de desligar nada, que e o tipo de passo esquecido
 * que deixa um app aberto na internet.
 *
 * A autorizacao e decidida na primeira etapa e viaja no proposito do desafio,
 * que so o servidor escreve. A segunda etapa nao confere o codigo de novo — o
 * consome. Antes era conferido nas duas, e o codigo de dispositivo, de uso
 * unico, ja tinha sido gasto na primeira: o registro falhava sempre no fim.
 */
export type Concessao =
  | { tipo: "bootstrap" }
  | { tipo: "sessao" }
  | { tipo: "dispositivo"; codigo: string }
  | { tipo: "recuperacao" }
  | { tipo: "convite"; codigo: string };

export async function autorizarRegistro(codigo?: string): Promise<Concessao | null> {
  if (!(await hasCredentials())) return { tipo: "bootstrap" };

  // Codigo digitado decide antes da sessao. Sem isso, a assistente
  // registrando a passkey dela num computador onde o dono esta logado
  // ganharia uma passkey de DONO.
  const limpo = codigo?.trim();
  if (limpo) {
    if (await codigoValido("convite", limpo)) return { tipo: "convite", codigo: limpo };
    if (await codigoValido("dispositivo", limpo)) return { tipo: "dispositivo", codigo: limpo };
    if (await checkRecoveryCode(limpo)) return { tipo: "recuperacao" };
    return null;
  }

  // Sessao da assistente nao registra nada sem convite: e o dono quem decide
  // quantos aparelhos ela tem.
  const sessao = await currentSession();
  if (sessao?.papel === "dono") return { tipo: "sessao" };

  return null;
}

export const propositoDoRegistro = (c: Concessao) =>
  "codigo" in c ? `registro:${c.tipo}:${c.codigo}` : `registro:${c.tipo}`;

/**
 * Fecha a concessao na segunda etapa e diz o papel da credencial nova.
 *
 * Nulo quando a concessao deixou de valer entre as etapas: o bootstrap que
 * outra aba ja fez, a sessao que saiu, o codigo que alguem usou antes.
 */
export async function concluirRegistro(purpose: string): Promise<Papel | null> {
  const [, tipo, codigo] = purpose.split(":");

  switch (tipo) {
    case "bootstrap":
      return (await hasCredentials()) ? null : "dono";
    case "sessao":
      return (await currentSession())?.papel === "dono" ? "dono" : null;
    case "recuperacao":
      return "dono";
    case "dispositivo":
      return codigo && (await consumirCodigo("dispositivo", codigo)) ? "dono" : null;
    case "convite":
      return codigo && (await consumirCodigo("convite", codigo)) ? "assistente" : null;
    default:
      return null;
  }
}


/** O papel que a credencial criada por esta concessao vai ter. */
export function papelDaConcessao(c: Concessao): Papel {
  return c.tipo === "convite" ? "assistente" : "dono";
}

/**
 * As credenciais que o navegador deve recusar recriar neste aparelho.
 *
 * So as do MESMO papel. A lista existe para nao registrar o mesmo aparelho
 * duas vezes, e nao como controle de acesso — esse e o convite. Com todas na
 * lista, o celular que ja tinha a passkey do dono recusava criar a da
 * assistente ("The authenticator was previously registered"), e testar o
 * convite no proprio aparelho, ou a assistente usar um computador da casa,
 * ficava impossivel.
 */
export function credenciaisAExcluir<T extends { id: string; papel: Papel }>(
  existentes: T[],
  concessao: Concessao,
): { id: string }[] {
  const papel = papelDaConcessao(concessao);
  return existentes.filter((c) => c.papel === papel).map((c) => ({ id: c.id }));
}
