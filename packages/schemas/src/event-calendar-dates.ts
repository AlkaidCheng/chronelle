import { z } from "zod";

export const calendarDateSchema = z.iso
  .date()
  .refine(
    (value) => !value.startsWith("0000"),
    "Year must be between 1 and 9999.",
  );

export const eventCalendarDatesSchema = z
  .object({
    startsOn: calendarDateSchema.nullable(),
    endsOn: calendarDateSchema.nullable(),
  })
  .refine(
    (value) =>
      value.endsOn === null ||
      (value.startsOn !== null && value.endsOn >= value.startsOn),
    "End date requires a start date and must not precede it.",
  );
