import { prisma } from "./db/connection";
import syncEnrollment, { SyncEnrollmentOutput, getStatusType } from "./sync";

const dtFormatter = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "America/Sao_Paulo",
});

async function main() {
  const enrollments = await prisma.enrollment.findMany({
    include: {
      student: true,
      course_class: {
        include: {
          course: true,
          institution: true,
        },
      },
    },
  });

  for (let i = 0; i < enrollments.length; i++) {
    const enrollment = enrollments[i];
    const actualStatusType = getStatusType(
      enrollment.confirmed_at,
      enrollment.last_access_at,
      enrollment.progress
    );
    if (actualStatusType === "Confirmed" || actualStatusType === "Active") {
      const input = {
        enrollmentId: enrollment.id,
        course: {
          id: enrollment.course_class.course.id,
          moodleId: enrollment.course_class.course.moodle_id,
        },
        courseClassId: enrollment.course_class.id,
        actualStatusType,
        confirmedAt: enrollment.confirmed_at,
        student: {
          id: enrollment.student.id,
          cpf: enrollment.student.cpf,
          email: enrollment.student.email,
          name: enrollment.student.name,
          lastName: enrollment.student.last_name,
        },
      };

      const output: SyncEnrollmentOutput = await syncEnrollment(input);
      if (output.courseLastAccess) {
        const courseLastAccessInput = dtFormatter
          .format(enrollment.last_access_at ?? undefined)
          .replace(", ", " ");

        const courseLastAccessOutput = dtFormatter
          .format(new Date(output.courseLastAccess * 1000))
          .replace(", ", " ");

        output.messages.push(courseLastAccessInput);
        if (courseLastAccessInput !== courseLastAccessOutput) {
          output.messages.push(courseLastAccessOutput);
        }
      }
      if (output.courseProgress) {
        output.messages.push(enrollment.progress.toFixed(2));
        if (
          enrollment.progress.toFixed(2) !== output.courseProgress.toFixed(2)
        ) {
          output.messages.push(output.courseProgress.toFixed(2));
        }
      }
      console.log(`> ${input.student.cpf},${output.messages.join(",")}`);
    }
  }
}

main();
