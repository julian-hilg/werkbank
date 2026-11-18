# Third-party notices

`@werkbank/chart-libraries` itself is under the MIT licence (`LICENSE`). It
redistributes the browser builds of the libraries below, unmodified, in
`vendor/`. Each remains under its own licence. The full licence texts and
notices, as published in each library's package, are in `vendor/licenses/`;
each build also carries its authors' own header.

| Library | File | Licence | Copyright | Texts |
| --- | --- | --- | --- | --- |
| [Apache ECharts](https://echarts.apache.org/) | `vendor/echarts.js` | Apache-2.0 | The Apache Software Foundation | `vendor/licenses/echarts/` (`LICENSE`, `NOTICE`, and `licenses/` for code it includes) |
| [D3](https://d3js.org/) | `vendor/d3.js` | ISC | Mike Bostock | `vendor/licenses/d3/` |
| [Chart.js](https://www.chartjs.org/) | `vendor/chartjs.js` | MIT | Chart.js Contributors | `vendor/licenses/chartjs/` |
| [Lightweight Charts](https://www.tradingview.com/lightweight-charts/) | `vendor/lightweight-charts.js` | Apache-2.0 | TradingView, Inc. | `vendor/licenses/lightweight-charts/` |
| [Plotly.js](https://plotly.com/javascript/) | `vendor/plotly.js` | MIT | Plotly, Inc. | `vendor/licenses/plotly/` |

The exact version of each build is in the header at the top of its file.

## If you ship an app that offers these libraries

- Keep this file and `vendor/licenses/` with any copy of the builds you pass on.
- **Lightweight Charts** asks that a page using it shows TradingView's
  attribution notice and a link to https://www.tradingview.com/. The library
  draws that link on the chart itself (the `layout.attributionLogo` option,
  on by default). Leave it on, or show the notice and link yourself.
- Names and logos of the libraries belong to their owners; using a library
  does not give a right to them.
