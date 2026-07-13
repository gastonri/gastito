import axios from "axios";
import { Logger } from "../utils/logger";
import { MONTH_NAMES_ES_CAP as MONTH_NAMES } from "../utils/months";

export class ChartService {
  static async generateDailyExpensesChart(
    year: number,
    month: number,
    gastosPorDia: { dia: number; monto: number }[]
  ): Promise<Buffer> {
    const today = new Date();
    const isCurrentMonth = year === today.getFullYear() && month === today.getMonth() + 1;
    const lastDay = isCurrentMonth ? today.getDate() : new Date(year, month, 0).getDate();

    const dailyData = Array<number>(lastDay).fill(0);
    for (const { dia, monto } of gastosPorDia) {
      if (dia >= 1 && dia <= lastDay) {
        dailyData[dia - 1] = Math.round(monto);
      }
    }

    const cumulativeData = dailyData.reduce<number[]>((acc, val) => {
      acc.push((acc[acc.length - 1] ?? 0) + val);
      return acc;
    }, []);

    const DAY_NAMES = ["Dom", "Lun", "Mar", "Mie", "Jue", "Vie", "Sab"];
    const labels = Array.from({ length: lastDay }, (_, i) => {
      const dow = new Date(year, month - 1, i + 1).getDay();
      return `${i + 1} ${DAY_NAMES[dow]}`;
    });
    const title = `Gastos de ${MONTH_NAMES[month - 1]} ${year}`;

    // Chart.js v2 syntax (QuickChart default)
    const chartConfig = {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            type: "bar",
            label: "Gasto diario",
            data: dailyData,
            backgroundColor: "rgba(99, 132, 255, 0.75)",
            yAxisID: "y",
          },
          {
            type: "line",
            label: "Acumulado",
            data: cumulativeData,
            borderColor: "rgb(255, 99, 132)",
            backgroundColor: "rgba(255, 99, 132, 0.1)",
            borderWidth: 2,
            pointRadius: 2,
            fill: false,
            yAxisID: "y2",
          },
        ],
      },
      options: {
        title: { display: true, text: title, fontSize: 16 },
        legend: { display: true, position: "top" },
        scales: {
          yAxes: [
            {
              id: "y",
              position: "left",
              scaleLabel: { display: true, labelString: "ARS / día" },
              ticks: { beginAtZero: true },
            },
            {
              id: "y2",
              position: "right",
              scaleLabel: { display: true, labelString: "Acumulado ARS" },
              ticks: { beginAtZero: true },
              gridLines: { drawOnChartArea: false },
            },
          ],
        },
      },
    };

    try {
      const response = await axios.post<ArrayBuffer>(
        "https://quickchart.io/chart",
        { chart: chartConfig, width: 800, height: 400, backgroundColor: "white" },
        { responseType: "arraybuffer", timeout: 15000 }
      );
      return Buffer.from(response.data);
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        const body = error.response?.data
          ? Buffer.from(error.response.data as ArrayBuffer)
              .toString("utf8")
              .substring(0, 300)
          : "no body";
        Logger.error(`QuickChart error ${status}: ${body}`, null);
      }
      throw error;
    }
  }

  static async generateComparisonChart(
    periodA: { year: number; month: number },
    periodB: { year: number; month: number },
    gastosA: { macro_categoria: string; monto: number }[],
    gastosB: { macro_categoria: string; monto: number }[]
  ): Promise<Buffer> {
    const totalsA = new Map<string, number>();
    for (const g of gastosA) {
      totalsA.set(g.macro_categoria, (totalsA.get(g.macro_categoria) ?? 0) + g.monto);
    }
    const totalsB = new Map<string, number>();
    for (const g of gastosB) {
      totalsB.set(g.macro_categoria, (totalsB.get(g.macro_categoria) ?? 0) + g.monto);
    }

    const categorias = [...new Set([...totalsA.keys(), ...totalsB.keys()])].sort(
      (a, b) =>
        (totalsA.get(b) ?? 0) +
        (totalsB.get(b) ?? 0) -
        ((totalsA.get(a) ?? 0) + (totalsB.get(a) ?? 0))
    );

    const labelA = `${MONTH_NAMES[periodA.month - 1]} ${periodA.year}`;
    const labelB = `${MONTH_NAMES[periodB.month - 1]} ${periodB.year}`;

    const chartConfig = {
      type: "bar",
      data: {
        labels: categorias,
        datasets: [
          {
            label: labelA,
            data: categorias.map((c) => Math.round(totalsA.get(c) ?? 0)),
            backgroundColor: "rgba(99, 132, 255, 0.75)",
          },
          {
            label: labelB,
            data: categorias.map((c) => Math.round(totalsB.get(c) ?? 0)),
            backgroundColor: "rgba(255, 159, 64, 0.75)",
          },
        ],
      },
      options: {
        title: { display: true, text: `${labelA} vs ${labelB}`, fontSize: 16 },
        legend: { display: true, position: "top" },
        scales: {
          yAxes: [
            {
              scaleLabel: { display: true, labelString: "ARS" },
              ticks: { beginAtZero: true },
            },
          ],
        },
      },
    };

    try {
      const response = await axios.post<ArrayBuffer>(
        "https://quickchart.io/chart",
        { chart: chartConfig, width: 800, height: 400, backgroundColor: "white" },
        { responseType: "arraybuffer", timeout: 15000 }
      );
      return Buffer.from(response.data);
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        const body = error.response?.data
          ? Buffer.from(error.response.data as ArrayBuffer)
              .toString("utf8")
              .substring(0, 300)
          : "no body";
        Logger.error(`QuickChart error ${status}: ${body}`, null);
      }
      throw error;
    }
  }
}
