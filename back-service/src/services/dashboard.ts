import { Types } from "mongoose";
import type { PipelineStage } from "mongoose";
import { AppError } from "@caloria/shared";
import type { DailyDashboardResponse, DailyRange } from "@caloria/shared";
import { MealModel } from "../models/Meal";
import { UserModel } from "../models/User";
import type { User } from "../models/User";
import { localDateIn } from "./local-date";
import { createStreakService } from "./streak";
import type { StreakService } from "./streak";

const MACROS = ["protein", "carbs", "fat"] as const;

export interface DashboardService {
  daily(userId: string, date?: string): Promise<DailyDashboardResponse>;
}

export interface DashboardServiceDeps {
  streak?: StreakService;
  now?: () => Date;
}

/** Lo que devuelve la agregación: sumas sin redondear y conteos por status. */
interface DailyTotals {
  kcalMin: number;
  kcalMax: number;
  proteinMin: number;
  proteinMax: number;
  carbsMin: number;
  carbsMax: number;
  fatMin: number;
  fatMax: number;
  ready: number;
  processing: number;
  failed: number;
}

const EMPTY_TOTALS: DailyTotals = {
  kcalMin: 0,
  kcalMax: 0,
  proteinMin: 0,
  proteinMax: 0,
  carbsMin: 0,
  carbsMax: 0,
  fatMin: 0,
  fatMax: 0,
  ready: 0,
  processing: 0,
  failed: 0,
};

/** Lo mismo que `rangeSchema`: números, sin negativos, finitos y con min ≤ max. */
const validRange = (path: string) => ({
  $and: [
    { $isNumber: `${path}.min` },
    { $isNumber: `${path}.max` },
    { $gte: [`${path}.min`, 0] },
    { $lte: [`${path}.min`, `${path}.max`] },
    { $lt: [`${path}.max`, Infinity] },
  ],
});

function currentValue(field: "kcal" | "macros") {
  const valid =
    field === "kcal"
      ? validRange("$$c.to")
      : { $and: MACROS.map((macro) => validRange(`$$c.to.${macro}`)) };
  return {
    $let: {
      vars: {
        last: {
          $last: {
            $filter: {
              input: "$corrections",
              as: "c",
              cond: { $and: [{ $eq: ["$$c.field", field] }, valid] },
            },
          },
        },
      },
      in: { $ifNull: ["$$last.to", `$analysis.${field}`] },
    },
  };
}

const countStatus = (status: string) => ({
  $sum: { $cond: [{ $eq: ["$status", status] }, 1, 0] },
});

export function dailyTotalsPipeline(userId: string, date: string): PipelineStage[] {
  const ready = { $eq: ["$status", "ready"] };
  const sums = Object.fromEntries(
    (["kcal", ...MACROS] as const).flatMap((key) =>
      (["min", "max"] as const).map((bound) => [
        `${key}${bound === "min" ? "Min" : "Max"}`,
        { $sum: { $cond: [ready, `$${key}.${bound}`, 0] } },
      ]),
    ),
  );
  return [
    { $match: { userId: new Types.ObjectId(userId), localDate: date } },
    { $set: { kcal: currentValue("kcal"), macros: currentValue("macros") } },
    {
      $set: {
        protein: "$macros.protein",
        carbs: "$macros.carbs",
        fat: "$macros.fat",
      },
    },
    {
      $group: {
        _id: null,
        ...sums,
        ready: countStatus("ready"),
        processing: countStatus("processing"),
        failed: countStatus("failed"),
      },
    },
    { $project: { _id: 0 } },
  ];
}

/** Se redondea recién en la respuesta: el punto medio sale de las sumas sin redondear. */
function dailyRange(min: number, max: number): DailyRange {
  return { min: Math.round(min), max: Math.round(max), mid: Math.round((min + max) / 2) };
}

export function createDashboardService({
  streak = createStreakService(),
  now = () => new Date(),
}: DashboardServiceDeps = {}): DashboardService {
  type UserFields = Pick<User, "profile" | "targets">;
  const findUser = (userId: string) =>
    UserModel.findById(userId, { "profile.timezone": 1, targets: 1 }).lean<UserFields>();
  const sumDay = async (userId: string, date: string) => {
    const [totals] = await MealModel.aggregate<DailyTotals>(dailyTotalsPipeline(userId, date));
    return totals ?? EMPTY_TOTALS;
  };

  return {
    async daily(userId, requestedDate) {
      // Con la fecha en la query, la meta y la suma van en paralelo. Sin fecha, hace falta la zona del perfil para saber qué día es hoy.
      let user: UserFields | null;
      let totals: DailyTotals | undefined;
      if (requestedDate) {
        [user, totals] = await Promise.all([findUser(userId), sumDay(userId, requestedDate)]);
      } else {
        user = await findUser(userId);
      }
      if (!user) throw new AppError("UNAUTHORIZED");
      // La racha es siempre respecto de hoy, aunque se pida otro día.
      const today = localDateIn(user.profile.timezone, now());
      const date = requestedDate ?? today;
      const [dayTotals, streakSummary] = await Promise.all([
        totals ?? sumDay(userId, date),
        streak.summary(userId, today),
      ]);

      const { kcal, proteinG, carbsG, fatG } = user.targets;
      return {
        date,
        consumed: {
          kcal: dailyRange(dayTotals.kcalMin, dayTotals.kcalMax),
          protein: dailyRange(dayTotals.proteinMin, dayTotals.proteinMax),
          carbs: dailyRange(dayTotals.carbsMin, dayTotals.carbsMax),
          fat: dailyRange(dayTotals.fatMin, dayTotals.fatMax),
        },
        targets: { kcal, proteinG, carbsG, fatG },
        meals: {
          ready: dayTotals.ready,
          processing: dayTotals.processing,
          failed: dayTotals.failed,
        },
        streak: streakSummary,
      };
    },
  };
}
