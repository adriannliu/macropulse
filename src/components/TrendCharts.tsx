import { useState, useMemo } from 'react';
import type { HistoryStore, UserProfile } from '../types';
import { calculateDayTotals, shiftDate, getTodayDate } from '../storage';
import { TrendingDown, TrendingUp, Target, Scale, Flame, Calendar, Award } from 'lucide-react';

interface TrendChartsProps {
  history: HistoryStore;
  profile: UserProfile;
  targetKcal: number;
  targetP: number;
  targetC: number;
  targetF: number;
  onSelectDate: (date: string) => void;
}

export function TrendCharts({
  history,
  profile,
  targetKcal,
  targetP,
  targetC,
  targetF,
  onSelectDate,
}: TrendChartsProps) {
  const [daysWindow, setDaysWindow] = useState<7 | 14 | 30>(14);
  const [hoveredDate, setHoveredDate] = useState<string | null>(null);

  const today = getTodayDate();

  // Generate continuous date array for the chosen window up to today
  const windowDays = useMemo(() => {
    const dates: string[] = [];
    for (let i = daysWindow - 1; i >= 0; i--) {
      dates.push(shiftDate(today, -i));
    }
    return dates;
  }, [daysWindow, today]);

  // Daily records mapped
  const seriesData = useMemo(() => {
    return windowDays.map((date) => {
      const record = history[date];
      const items = record?.items || [];
      const totals = calculateDayTotals(items);
      const weight = record?.weightKg ?? null;
      const hasLog = items.length > 0;
      return {
        date,
        shortDate: date.slice(5), // 'MM-DD'
        totals,
        weight,
        hasLog,
        dayTargetKcal: record?.targetKcal || targetKcal,
        dayTargetP: record?.targetP || targetP,
      };
    });
  }, [windowDays, history, targetKcal, targetP]);

  // Aggregated stats over logged days
  const stats = useMemo(() => {
    const logged = seriesData.filter((d) => d.hasLog);
    if (logged.length === 0) {
      return {
        loggedCount: 0,
        avgKcal: 0,
        avgP: 0,
        avgC: 0,
        avgF: 0,
        proteinAdherence: 0,
        weightDelta: 0,
        startWeight: profile.weightKg,
        endWeight: profile.weightKg,
      };
    }

    const totalKcal = logged.reduce((acc, d) => acc + d.totals.kcal, 0);
    const totalP = logged.reduce((acc, d) => acc + d.totals.p, 0);
    const totalC = logged.reduce((acc, d) => acc + d.totals.c, 0);
    const totalF = logged.reduce((acc, d) => acc + d.totals.f, 0);

    const hitProtein = logged.filter((d) => d.totals.p >= d.dayTargetP * 0.95).length;
    const proteinAdherence = Math.round((hitProtein / logged.length) * 100);

    // Weight stats
    const weightEntries = seriesData.filter((d) => d.weight !== null);
    const startWeight = weightEntries.length > 0 ? (weightEntries[0].weight as number) : profile.weightKg;
    const endWeight =
      weightEntries.length > 0
        ? (weightEntries[weightEntries.length - 1].weight as number)
        : profile.weightKg;
    const weightDelta = Math.round((endWeight - startWeight) * 10) / 10;

    return {
      loggedCount: logged.length,
      avgKcal: Math.round(totalKcal / logged.length),
      avgP: Math.round(totalP / logged.length),
      avgC: Math.round(totalC / logged.length),
      avgF: Math.round(totalF / logged.length),
      proteinAdherence,
      weightDelta,
      startWeight,
      endWeight,
    };
  }, [seriesData, profile.weightKg]);

  // SVG Chart Dimensions
  const chartHeight = 220;
  const paddingX = 40;
  const paddingY = 30;

  // Max Kcal for scale
  const maxKcal = useMemo(() => {
    const highestLogged = Math.max(...seriesData.map((d) => d.totals.kcal), targetKcal);
    return Math.max(highestLogged * 1.15, 3000);
  }, [seriesData, targetKcal]);

  // Weight scale min/max
  const weightScale = useMemo(() => {
    const weights = seriesData
      .map((d) => d.weight)
      .filter((w): w is number => w !== null && w > 0);
    if (weights.length === 0) {
      return { min: profile.weightKg - 2, max: profile.weightKg + 2 };
    }
    const min = Math.floor(Math.min(...weights) - 1);
    const max = Math.ceil(Math.max(...weights) + 1);
    return { min, max: Math.max(max, min + 2) };
  }, [seriesData, profile.weightKg]);

  return (
    <div className="space-y-6">
      {/* Timeframe Bar */}
      <div className="flex flex-wrap justify-between items-center bg-slate-900/70 border border-slate-800 rounded-xl p-4">
        <div>
          <h2 className="text-base font-bold text-white flex items-center gap-2">
            <Award className="w-5 h-5 text-indigo-400" />
            Macro & Telemetry Analytics
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Historical trends across {stats.loggedCount} of {daysWindow} days logged
          </p>
        </div>

        <div className="flex items-center gap-1.5 mt-3 sm:mt-0 bg-slate-950 p-1 rounded-lg border border-slate-800">
          {([7, 14, 30] as const).map((w) => (
            <button
              key={w}
              onClick={() => setDaysWindow(w)}
              className={`px-3 py-1 rounded text-xs font-mono font-medium transition ${
                daysWindow === w
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Last {w}d
            </button>
          ))}
        </div>
      </div>

      {/* KPI Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {/* Average Calories */}
        <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-4">
          <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
            <span>Avg Calories</span>
            <Flame className="w-4 h-4 text-amber-400" />
          </div>
          <div className="text-2xl font-mono font-bold text-white">
            {stats.avgKcal} <span className="text-xs text-slate-500">kcal/d</span>
          </div>
          <div className="text-xs font-mono mt-1 text-slate-400">
            Target: <span className="text-slate-300">{targetKcal}</span> ·{' '}
            <span
              className={
                stats.avgKcal >= targetKcal - 100 && stats.avgKcal <= targetKcal + 100
                  ? 'text-emerald-400'
                  : stats.avgKcal > targetKcal
                  ? 'text-amber-400'
                  : 'text-rose-400'
              }
            >
              {stats.avgKcal - targetKcal > 0 ? '+' : ''}
              {stats.avgKcal - targetKcal} delta
            </span>
          </div>
        </div>

        {/* Protein Adherence */}
        <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-4">
          <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
            <span>Protein Hit Rate</span>
            <Target className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-2xl font-mono font-bold text-emerald-400">
            {stats.proteinAdherence}%
          </div>
          <div className="text-xs font-mono mt-1 text-slate-400">
            Avg <span className="text-emerald-300 font-bold">{stats.avgP}g</span> vs {targetP}g target
          </div>
        </div>

        {/* Weight Trend */}
        <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-4">
          <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
            <span>Weight Trend</span>
            <Scale className="w-4 h-4 text-indigo-400" />
          </div>
          <div className="text-2xl font-mono font-bold text-white flex items-center gap-1.5">
            {stats.endWeight} <span className="text-xs text-slate-500">kg</span>
            {stats.weightDelta !== 0 && (
              <span
                className={`text-xs px-1.5 py-0.5 rounded font-mono flex items-center ${
                  stats.weightDelta < 0
                    ? 'text-indigo-300 bg-indigo-950/80 border border-indigo-800'
                    : 'text-amber-300 bg-amber-950/80 border border-amber-800'
                }`}
              >
                {stats.weightDelta < 0 ? (
                  <TrendingDown className="w-3 h-3 mr-0.5" />
                ) : (
                  <TrendingUp className="w-3 h-3 mr-0.5" />
                )}
                {stats.weightDelta > 0 ? '+' : ''}
                {stats.weightDelta} kg
              </span>
            )}
          </div>
          <div className="text-xs font-mono mt-1 text-slate-400">
            From {stats.startWeight}kg ({daysWindow}d window)
          </div>
        </div>

        {/* Macro Distribution */}
        <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-4">
          <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
            <span>Avg Daily Split</span>
            <span className="text-[10px] font-mono text-slate-500">P · C · F</span>
          </div>
          <div className="text-lg font-mono font-bold text-slate-200 mt-0.5">
            <span className="text-emerald-400">{stats.avgP}g</span> ·{' '}
            <span className="text-amber-400">{stats.avgC}g</span> ·{' '}
            <span className="text-rose-400">{stats.avgF}g</span>
          </div>
          <div className="text-xs font-mono mt-1.5 text-slate-400 flex gap-2">
            <span>Targets:</span>
            <span className="text-emerald-400/80">{targetP}P</span>
            <span className="text-amber-400/80">{targetC}C</span>
            <span className="text-rose-400/80">{targetF}F</span>
          </div>
        </div>
      </div>

      {/* Chart 1: Daily Calorie Intake vs Target Line */}
      <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-5">
        <div className="flex justify-between items-center mb-4">
          <div>
            <h3 className="text-sm font-semibold text-slate-200">Daily Caloric Intake</h3>
            <p className="text-xs text-slate-500 font-mono mt-0.5">
              Bars show daily calories. Dashed cyan line is your target ({targetKcal} kcal).
            </p>
          </div>
          <div className="flex items-center gap-3 text-xs font-mono">
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500"></span>
              <span className="text-slate-400">Logged</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-0.5 border-t-2 border-dashed border-cyan-400"></span>
              <span className="text-slate-400">Target</span>
            </div>
          </div>
        </div>

        {/* SVG Container */}
        <div className="w-full overflow-x-auto">
          <svg
            viewBox={`0 0 ${Math.max(600, windowDays.length * 48)} ${chartHeight}`}
            className="w-full h-56 select-none"
          >
            {/* Target line */}
            {(() => {
              const svgWidth = Math.max(600, windowDays.length * 48);
              const targetY =
                chartHeight -
                paddingY -
                (targetKcal / maxKcal) * (chartHeight - paddingY * 2);
              return (
                <g>
                  <line
                    x1={paddingX}
                    y1={targetY}
                    x2={svgWidth - 20}
                    y2={targetY}
                    stroke="#22d3ee"
                    strokeWidth="1.5"
                    strokeDasharray="4 4"
                  />
                  <text
                    x={svgWidth - 16}
                    y={targetY + 4}
                    fill="#22d3ee"
                    fontSize="10"
                    fontFamily="monospace"
                  >
                    {targetKcal}
                  </text>
                </g>
              );
            })()}

            {/* Bars */}
            {seriesData.map((d, index) => {
              const svgWidth = Math.max(600, windowDays.length * 48);
              const barWidth = Math.max(16, (svgWidth - paddingX - 40) / windowDays.length - 10);
              const x = paddingX + index * ((svgWidth - paddingX - 40) / windowDays.length);
              const barHeight = d.hasLog
                ? (d.totals.kcal / maxKcal) * (chartHeight - paddingY * 2)
                : 4;
              const y = chartHeight - paddingY - barHeight;

              const isHovered = hoveredDate === d.date;
              const isOver = d.totals.kcal > targetKcal + 150;
              const isUnder = d.hasLog && d.totals.kcal < targetKcal - 250;
              const barColor = !d.hasLog
                ? '#1e293b'
                : isOver
                ? '#f59e0b'
                : isUnder
                ? '#60a5fa'
                : '#10b981';

              return (
                <g
                  key={d.date}
                  className="cursor-pointer transition-opacity"
                  opacity={hoveredDate && !isHovered ? 0.45 : 1}
                  onMouseEnter={() => setHoveredDate(d.date)}
                  onMouseLeave={() => setHoveredDate(null)}
                  onClick={() => onSelectDate(d.date)}
                >
                  {/* Bar */}
                  <rect
                    x={x}
                    y={y}
                    width={barWidth}
                    height={Math.max(4, barHeight)}
                    rx="3"
                    fill={barColor}
                  />

                  {/* Kcal value on hover */}
                  {d.hasLog && (
                    <text
                      x={x + barWidth / 2}
                      y={y - 6}
                      textAnchor="middle"
                      fill="#e2e8f0"
                      fontSize="9"
                      fontFamily="monospace"
                    >
                      {Math.round(d.totals.kcal)}
                    </text>
                  )}

                  {/* Date label on X axis */}
                  <text
                    x={x + barWidth / 2}
                    y={chartHeight - 10}
                    textAnchor="middle"
                    fill={d.date === today ? '#a78bfa' : '#64748b'}
                    fontSize="10"
                    fontFamily="monospace"
                    fontWeight={d.date === today ? 'bold' : 'normal'}
                  >
                    {d.shortDate}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      </div>

      {/* Chart 2: Daily Macro Composition (P / C / F) */}
      <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-5">
        <div className="flex justify-between items-center mb-4">
          <div>
            <h3 className="text-sm font-semibold text-slate-200">Daily Macronutrient Breakdown</h3>
            <p className="text-xs text-slate-500 font-mono mt-0.5">
              Daily grams of Protein (green), Carbs (amber), and Fats (rose)
            </p>
          </div>
          <div className="flex items-center gap-3 text-xs font-mono">
            <span className="flex items-center gap-1 text-emerald-400">
              <span className="w-2 h-2 rounded-full bg-emerald-500"></span> Protein
            </span>
            <span className="flex items-center gap-1 text-amber-400">
              <span className="w-2 h-2 rounded-full bg-amber-500"></span> Carbs
            </span>
            <span className="flex items-center gap-1 text-rose-400">
              <span className="w-2 h-2 rounded-full bg-rose-500"></span> Fat
            </span>
          </div>
        </div>

        <div className="w-full overflow-x-auto">
          <svg
            viewBox={`0 0 ${Math.max(600, windowDays.length * 48)} ${chartHeight}`}
            className="w-full h-56 select-none"
          >
            {seriesData.map((d, index) => {
              const svgWidth = Math.max(600, windowDays.length * 48);
              const slotWidth = (svgWidth - paddingX - 40) / windowDays.length;
              const xBase = paddingX + index * slotWidth;
              const barW = Math.max(5, slotWidth / 4);

              const maxMacro = Math.max(targetP, targetC, 280);
              const scaleMacro = (val: number) =>
                (val / maxMacro) * (chartHeight - paddingY * 2);

              const pHeight = scaleMacro(d.totals.p);
              const cHeight = scaleMacro(d.totals.c);
              const fHeight = scaleMacro(d.totals.f);

              return (
                <g
                  key={d.date}
                  className="cursor-pointer"
                  onClick={() => onSelectDate(d.date)}
                >
                  {/* P Bar */}
                  <rect
                    x={xBase}
                    y={chartHeight - paddingY - pHeight}
                    width={barW}
                    height={Math.max(2, pHeight)}
                    rx="2"
                    fill="#10b981"
                  />
                  {/* C Bar */}
                  <rect
                    x={xBase + barW + 2}
                    y={chartHeight - paddingY - cHeight}
                    width={barW}
                    height={Math.max(2, cHeight)}
                    rx="2"
                    fill="#f59e0b"
                  />
                  {/* F Bar */}
                  <rect
                    x={xBase + (barW + 2) * 2}
                    y={chartHeight - paddingY - fHeight}
                    width={barW}
                    height={Math.max(2, fHeight)}
                    rx="2"
                    fill="#f43f5e"
                  />

                  {/* Date label */}
                  <text
                    x={xBase + barW * 1.5}
                    y={chartHeight - 10}
                    textAnchor="middle"
                    fill="#64748b"
                    fontSize="10"
                    fontFamily="monospace"
                  >
                    {d.shortDate}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      </div>

      {/* Chart 3: Weight Trend Over Time */}
      <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-5">
        <div className="flex justify-between items-center mb-4">
          <div>
            <h3 className="text-sm font-semibold text-slate-200">Weight Tracking Curve</h3>
            <p className="text-xs text-slate-500 font-mono mt-0.5">
              Daily morning weigh-in trajectory (range: {weightScale.min} - {weightScale.max} kg)
            </p>
          </div>
          <div className="text-xs font-mono text-indigo-400">
            {stats.weightDelta !== 0 && (
              <span>
                Net change: {stats.weightDelta > 0 ? '+' : ''}
                {stats.weightDelta} kg
              </span>
            )}
          </div>
        </div>

        <div className="w-full overflow-x-auto">
          <svg
            viewBox={`0 0 ${Math.max(600, windowDays.length * 48)} 180`}
            className="w-full h-44 select-none"
          >
            {/* Horizontal Grid lines */}
            {[0, 0.5, 1].map((ratio) => {
              const svgWidth = Math.max(600, windowDays.length * 48);
              const y = 20 + ratio * (180 - 50);
              const val = Math.round(
                (weightScale.max - ratio * (weightScale.max - weightScale.min)) * 10
              ) / 10;
              return (
                <g key={ratio}>
                  <line
                    x1={paddingX}
                    y1={y}
                    x2={svgWidth - 20}
                    y2={y}
                    stroke="#1e293b"
                    strokeWidth="1"
                    strokeDasharray="2 2"
                  />
                  <text
                    x={paddingX - 8}
                    y={y + 3}
                    textAnchor="end"
                    fill="#64748b"
                    fontSize="9"
                    fontFamily="monospace"
                  >
                    {val}
                  </text>
                </g>
              );
            })}

            {/* Connecting Line and Dots */}
            {(() => {
              const svgWidth = Math.max(600, windowDays.length * 48);
              const points = seriesData
                .map((d, idx) => {
                  if (d.weight === null) return null;
                  const x =
                    paddingX + idx * ((svgWidth - paddingX - 40) / (windowDays.length - 1 || 1));
                  const y =
                    20 +
                    ((weightScale.max - d.weight) /
                      (weightScale.max - weightScale.min || 1)) *
                      (180 - 50);
                  return { x, y, weight: d.weight, date: d.date, shortDate: d.shortDate };
                })
                .filter((p): p is { x: number; y: number; weight: number; date: string; shortDate: string } => p !== null);

              if (points.length < 2) return null;

              const pathD = points.reduce(
                (acc, pt, i) => `${acc} ${i === 0 ? 'M' : 'L'} ${pt.x} ${pt.y}`,
                ''
              );

              return (
                <g>
                  {/* Smooth curve line */}
                  <path
                    d={pathD}
                    fill="none"
                    stroke="#818cf8"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                  />

                  {/* Points */}
                  {points.map((pt) => (
                    <g
                      key={pt.date}
                      className="cursor-pointer"
                      onClick={() => onSelectDate(pt.date)}
                    >
                      <circle cx={pt.x} cy={pt.y} r="4" fill="#6366f1" stroke="#090a0f" strokeWidth="2" />
                      <text
                        x={pt.x}
                        y={pt.y - 8}
                        textAnchor="middle"
                        fill="#cbd5e1"
                        fontSize="9"
                        fontFamily="monospace"
                      >
                        {pt.weight}
                      </text>
                    </g>
                  ))}
                </g>
              );
            })()}
          </svg>
        </div>
      </div>

      {/* Historical Days Table */}
      <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-4">
        <h3 className="text-sm font-semibold text-slate-200 mb-3 flex items-center gap-2">
          <Calendar className="w-4 h-4 text-slate-400" />
          Recent Log History
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400">
                <th className="pb-2 font-normal">Date</th>
                <th className="pb-2 font-normal">Weight</th>
                <th className="pb-2 font-normal">Calories</th>
                <th className="pb-2 font-normal">Protein</th>
                <th className="pb-2 font-normal">Carbs</th>
                <th className="pb-2 font-normal">Fats</th>
                <th className="pb-2 font-normal text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {seriesData
                .slice()
                .reverse()
                .map((d) => (
                  <tr key={d.date} className="hover:bg-slate-800/40 transition">
                    <td className="py-2.5 text-slate-200 font-medium">
                      {d.date}{' '}
                      {d.date === today && (
                        <span className="text-[10px] text-emerald-400 bg-emerald-950/60 border border-emerald-800 px-1.5 py-0.2 rounded ml-1">
                          Today
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 text-indigo-300">
                      {d.weight ? `${d.weight} kg` : <span className="text-slate-600">—</span>}
                    </td>
                    <td className="py-2.5 text-slate-200">
                      {d.hasLog ? (
                        <span>
                          {Math.round(d.totals.kcal)}{' '}
                          <span className="text-[10px] text-slate-500">
                            ({d.totals.kcal - targetKcal > 0 ? '+' : ''}
                            {Math.round(d.totals.kcal - targetKcal)})
                          </span>
                        </span>
                      ) : (
                        <span className="text-slate-600">No log</span>
                      )}
                    </td>
                    <td className="py-2.5 text-emerald-400">
                      {d.hasLog ? `${d.totals.p.toFixed(1)}g` : '—'}
                    </td>
                    <td className="py-2.5 text-amber-400">
                      {d.hasLog ? `${d.totals.c.toFixed(1)}g` : '—'}
                    </td>
                    <td className="py-2.5 text-rose-400">
                      {d.hasLog ? `${d.totals.f.toFixed(1)}g` : '—'}
                    </td>
                    <td className="py-2.5 text-right">
                      <button
                        onClick={() => onSelectDate(d.date)}
                        className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-[11px] transition"
                      >
                        Open Day →
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
