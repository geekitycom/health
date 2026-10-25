import type { Child } from 'hono/jsx';

const STYLE = `
:root {
    color-scheme: light dark;
    --bg: #f6f7f9; --card: #fff; --text: #1d2330; --muted: #667085;
    --line: #e3e6eb; --accent: #2f7d5b; --accent-text: #fff; --danger: #b42318;
}
@media (prefers-color-scheme: dark) {
    :root {
        --bg: #12151b; --card: #1b2029; --text: #e6e9ef; --muted: #98a2b3;
        --line: #2c3340; --accent: #4fb488; --accent-text: #0b1a13; --danger: #f97066;
    }
}
* { box-sizing: border-box; }
body {
    margin: 0; background: var(--bg); color: var(--text);
    font: 16px/1.45 system-ui, -apple-system, sans-serif;
}
header {
    display: flex; gap: 16px; align-items: center; padding: 12px 16px;
    border-bottom: 1px solid var(--line); background: var(--card);
}
header strong { margin-right: auto; }
header a { color: var(--muted); text-decoration: none; }
header a[aria-current] { color: var(--text); font-weight: 600; }
main { max-width: 760px; margin: 0 auto; padding: 16px; display: grid; gap: 16px; }
section { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 16px; }
h2 { margin: 0 0 12px; font-size: 1.05rem; }
form.entry { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 10px; }
form.entry .wide { grid-column: 1 / -1; }
label { display: grid; gap: 4px; font-size: .8rem; color: var(--muted); }
input, select, button {
    font: inherit; padding: 8px 10px; border-radius: 6px;
    border: 1px solid var(--line); background: var(--bg); color: var(--text); min-width: 0;
}
button { background: var(--accent); color: var(--accent-text); border: 0; font-weight: 600; cursor: pointer; }
button.link { background: none; color: var(--danger); padding: 2px 6px; font-weight: 400; }
table { width: 100%; border-collapse: collapse; font-size: .9rem; }
th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
th { color: var(--muted); font-weight: 500; }
td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
.table-wrap { overflow-x: auto; }
.muted { color: var(--muted); }
.error { background: var(--danger); color: #fff; padding: 10px 14px; border-radius: 8px; }
.daynav { display: flex; gap: 8px; align-items: center; justify-content: space-between; }
.daynav form { display: flex; gap: 8px; }
.daynav a { color: var(--accent); text-decoration: none; font-weight: 600; }
.stats { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 12px; }
.stat b { display: block; font-size: 1.3rem; font-variant-numeric: tabular-nums; }
.stat span { font-size: .8rem; color: var(--muted); }
svg.spark { width: 100%; height: 80px; }
svg.spark polyline { fill: none; stroke: var(--accent); stroke-width: 2; vector-effect: non-scaling-stroke; }
`;

export function Layout(props: {
    title: string;
    nav: 'today' | 'history';
    children: Child;
}) {
    return (
        <html lang="en">
            <head>
                <meta charset="utf-8" />
                <meta
                    name="viewport"
                    content="width=device-width, initial-scale=1"
                />
                <title>{props.title}</title>
                <style dangerouslySetInnerHTML={{ __html: STYLE }} />
            </head>
            <body>
                <header>
                    <strong>Health</strong>
                    <a
                        href="/"
                        aria-current={
                            props.nav === 'today' ? 'page' : undefined
                        }
                    >
                        Day
                    </a>
                    <a
                        href="/history"
                        aria-current={
                            props.nav === 'history' ? 'page' : undefined
                        }
                    >
                        History
                    </a>
                </header>
                <main>{props.children}</main>
            </body>
        </html>
    );
}
