import { prisma } from "./db/connection";
import syncEnrollment, { SyncEnrollmentOutput } from "./sync";

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
      enrollment_status: {
        take: 1,
        orderBy: {
          created_at: "desc",
        },
      },
    },
  });

  for (let i = 0; i < enrollments.length; i++) {
    const enrollment = enrollments[i];
    const input = {
      enrollmentId: enrollment.id,
      course: {
        id: enrollment.course_class.course.id,
        moodleId: enrollment.course_class.course.moodle_id,
      },
      courseClassId: enrollment.course_class.id,
      enrollmentLastStatusType:
        enrollment.enrollment_status[0].enrollment_status_type,
      enrollmentLastStatusCreatedAt: enrollment.enrollment_status[0].created_at,
      student: {
        id: enrollment.student.id,
        cpf: enrollment.student.cpf,
        email: enrollment.student.email,
        name: enrollment.student.name,
        lastName: enrollment.student.last_name,
      },
    };

    const output: SyncEnrollmentOutput = await syncEnrollment(input);
    output.courseLastAccess &&
      output.messages.push(output.courseLastAccess.toString());
    output.courseProgress &&
      output.messages.push(output.courseProgress.toString());
    console.log(
      `${input.enrollmentId},${input.student.cpf},${output.messages.join(",")}`
    );
  }
}

main();
