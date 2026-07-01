// Named Chart.js imports instead of 'chart.js/auto', which registers every
// controller/element/scale/plugin Chart.js ships (radar, pie, polar, bubble,
// filler, decimation, subtitle...) regardless of use. The dashboard only ever
// draws bar charts, one mixed bar+line chart, and horizontal bars (indexAxis:
// 'y' is the same BarController/BarElement, just flipped) - so this is the
// full set actually needed, registered once and shared by every tab.
import {
  Chart,
  BarController,
  LineController,
  BarElement,
  LineElement,
  PointElement,
  CategoryScale,
  LinearScale,
  Legend,
  Tooltip,
} from 'chart.js';

Chart.register(
  BarController, LineController,
  BarElement, LineElement, PointElement,
  CategoryScale, LinearScale,
  Legend, Tooltip,
);

export default Chart;
