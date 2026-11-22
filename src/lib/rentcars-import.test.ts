import { describe, expect, it } from "vitest";
import {
  brNumber,
  categoriaPorModelo,
  locadoraDoLogo,
  pageKind,
  parseLista,
  parseOferta,
  parseRentcarsUrl,
} from "./rentcars-import";

const LISTA = `78 carros encontrados
Até 10% OFF
[logo:carro]
[logo:Volkswagen Taos]
Volkswagen Taos
ou SUV similar
5
A/C
Automático
3
Proteções inclusas
Cancelamento grátis
Quilometragem livre
Taxas da Locadora
[logo:Europcar]
Cashback US$ 9,04
US$ 410,64
Por 7 dias
US$ 58,65/dia
Continuar
Aeroporto de Orlando, MCO, Estados Unidos
[logo:Nissan Kicks]
Nissan Kicks
ou SUV similar
5
A/C
Proteções inclusas
Condutor Adicional
Taxas da Locadora
[logo:hertz-logo.png]
US$
1.647,89
Por 7 dias
Continuar
[logo:Dodge Grand Caravan]
Dodge Grand Caravan
ou Minivan similar
7
[logo:Sixt]
US$ 900,00
Por 7 dias
Continuar`;

const OFERTA = `Adicione opcionais à sua reserva
Bebê Conforto
US$ 16,24 /dia
Cadeirinha para Criança
US$
16,24
/dia
Assento de Elevação
US$ 16,24 /dia
Sua reserva
7 diárias
Volkswagen Taos
ou suv similar
[logo:Europcar]
Valor do veículo
US$ 408,30
Taxas da Locadora
US$ 2,34`;

describe("rentcars", () => {
  it("datas do link em horário de Brasília", () => {
    expect(
      parseRentcarsUrl(
        "https://www.rentcars.com/pt-br/reserva/listar/621-1807794000-621-1808398800-0-0-0-0-0-0-0-0",
      ),
    ).toEqual({
      pickupAt: "2027-04-15T10:00:00",
      returnAt: "2027-04-22T10:00:00",
      days: 7,
    });
    expect(
      pageKind(
        "https://www.rentcars.com/pt-br/reserva/configurar/621-1807794000-621-1808398800-732-24/19095/USD/BR?step=1",
      ),
    ).toBe("oferta");
  });
  it("números em formato brasileiro", () => {
    expect(brNumber("US$ 1.395,20")).toBe(1395.2);
    expect(brNumber("410,64")).toBe(410.64);
  });
  it("logo vira o nome da locadora", () => {
    expect(locadoraDoLogo("hertz-logo.png")).toBe("Hertz");
    expect(locadoraDoLogo("Europcar")).toBe("Europcar");
  });
  it("lista: uma cotação por carro, com locadora, total e pareamento", () => {
    const r = parseLista(LISTA, 7);
    expect(r.map((x) => [x.locadora, x.modelo, x.total, x.categoria, x.motoristaIncluso])).toEqual([
      ["Europcar", "Volkswagen Taos", 410.64, null, false],
      ["Hertz", "Nissan Kicks", 1647.89, null, true],
      ["Sixt", "Dodge Grand Caravan", 900, "Mini Van 8 Seats", false],
    ]);
    expect(r[0]!.lugares).toBe(5);
  });
  it("oferta: cadeirinha por dia, taxas e locadora", () => {
    expect(parseOferta(OFERTA)).toEqual({
      locadora: "Europcar",
      modelo: "Volkswagen Taos",
      cadeirinha: 16.24,
      motorista: null,
      taxas: 2.34,
      valorVeiculo: 408.3,
    });
  });
  it("pareamento igual ao do coletor", () => {
    expect(categoriaPorModelo("Toyota Corolla", 5)).toBe("Midsize Sedan");
    expect(categoriaPorModelo("Chevrolet Express", 15, "Van")).toBeNull();
    expect(categoriaPorModelo("Chevrolet Suburban", 7)).toBe("SUV Executive 7 Seats");
  });
});
