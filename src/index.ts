import { prisma } from "./db/connection";
import syncEnrollment, { SyncEnrollmentOutput, getStatusType } from "./sync";

const dtFormatter = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "America/Sao_Paulo",
});

await (async () => {
  const institutions = await prisma.institution.findMany({
    include: {
      course_class: {
        include: {
          course: true,
          enrollment: {
            include: {
              student: true,
            },
            orderBy: [
              {
                student: {
                  name: "asc",
                },
              },
              {
                student: {
                  last_name: "asc",
                },
              },
            ],
          }
        },
      },
    },
    orderBy: [
      {
        short_name: 'asc'
      }
    ]
  });

  for (let j = 0; j < institutions.length; j++) {
    const institution = institutions[j];
    const enrollments = institution.course_class[0].enrollment;
    console.log(`### ${institution.short_name}`)

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
            id: institution.course_class[0].course_id,
            moodleId: institution.course_class[0].course.moodle_id
          },
          courseClassId: institution.course_class[0].id,
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
})()
