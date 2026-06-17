import axios from "axios";
import { Logger } from "../utils/logger";

const MONTH_NAMES = [
  "Enero","Febrero","Marzo","Abril","Mayo","Junio",
  "Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre",
];

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

    const DAY_NAMES = ["Dom","Lun","Mar","Mie","Jue","Vie","Sab"];
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
          ? Buffer.from(error.response.data as ArrayBuffer).toString("utf8").substring(0, 300)
          : "no body";
        Logger.error(`QuickChart error ${status}: ${body}`, null);
      }
      throw error;
    }
  }
}
