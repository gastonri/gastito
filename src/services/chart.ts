import axios from "axios";

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

    const labels = Array.from({ length: lastDay }, (_, i) => String(i + 1));
    const title = `Gastos de ${MONTH_NAMES[month - 1]} ${year}`;

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
            order: 2,
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
            tension: 0.1,
            yAxisID: "y2",
            order: 1,
          },
        ],
      },
      options: {
        plugins: {
          title: { display: true, text: title, font: { size: 16 } },
          legend: { display: true, position: "top" },
        },
        scales: {
          y: {
            position: "left",
            title: { display: true, text: "ARS / día" },
            beginAtZero: true,
          },
          y2: {
            position: "right",
            title: { display: true, text: "Acumulado ARS" },
            beginAtZero: true,
            grid: { drawOnChartArea: false },
          },
        },
      },
    };

    const response = await axios.post<ArrayBuffer>(
      "https://quickchart.io/chart",
      { chart: chartConfig, width: 800, height: 400, backgroundColor: "white" },
      { responseType: "arraybuffer", timeout: 15000 }
    );

    return Buffer.from(response.data);
  }
}
