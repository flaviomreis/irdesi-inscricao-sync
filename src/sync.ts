import { prisma } from "./db/connection";
import sendMoodleRequest from "./moodle-request";

export type StudentProps = {
  studentId: string;
  cpf: string;
  actual: {
    email: string;
    name: string;
    lastName: string;
  };
  moodle: {
    email: string;
    name: string;
    lastName: string;
  };
};

export type SyncEnrollmentInput = {
  enrollmentId: string;
  course: {
    id: string;
    moodleId: string;
  };
  courseClassId: string;
  actualStatusType: string;
  confirmedAt: Date | null;
  student: {
    id: string;
    cpf: string;
    email: string;
    name: string;
    lastName: string;
  };
};

export type SyncEnrollmentOutput = {
  status: number;
  messages: string[];
  courseLastAccess?: number;
  courseProgress?: number;
};

export function getStatusType(
  enrollmentConfirmedAt: Date | null,
  courseLastAccess: Date | number | null,
  courseProgress: number
) {
  const statusType = courseLastAccess
    ? courseProgress < 100
      ? "Active"
      : "Completed"
    : !enrollmentConfirmedAt
    ? "Sent"
    : "Confirmed";

  return statusType;
}

export async function updateEnrollmentStatusIfNecessary(
  enrollment_id: string,
  actualStatusType: string,
  enrollmentConfirmedAt: Date | null,
  courseLastAccess: number | null,
  courseProgress: number
) {
  const newStatusType = getStatusType(
    enrollmentConfirmedAt,
    courseLastAccess,
    courseProgress
  );
  if (courseLastAccess) {
    await prisma.enrollment.update({
      where: {
        id: enrollment_id,
      },
      data: {
        last_access_at: new Date(courseLastAccess * 1000),
        progress: courseProgress,
      },
    });
  } else {
    if (!enrollmentConfirmedAt) {
      console.log(">>> ", enrollmentConfirmedAt);
      await updateEnrollmentToSent(enrollment_id);
    }
  }

  if (actualStatusType !== newStatusType) {
    return [actualStatusType, newStatusType];
  } else {
    return [actualStatusType];
  }
}

export async function updateStudentIfNecessary(data: StudentProps) {
  if (JSON.stringify(data.actual) !== JSON.stringify(data.moodle)) {
    await prisma.student.update({
      where: {
        id: data.studentId,
      },
      data: {
        email: data.moodle.email,
        name: data.moodle.name,
        last_name: data.moodle.lastName,
      },
    });
    return "Dados do aluno foram atualizado";
  } else {
    return "Dados do aluno sem atualização";
  }
}

async function updateEnrollmentToSent(enrollment_id: string) {
  // await prisma.enrollment.update({
  //   where: {
  //     id: enrollment_id,
  //   },
  //   data: {
  //     confirmed_at: null,
  //     last_access_at: null,
  //     progress: 0,
  //   },
  // });
  console.log("Algum muito estranho: Status retornado para Sent");
}

/*
 *
 * Aqui começa
 *
 */

export default async function syncEnrollment(
  input: SyncEnrollmentInput
): Promise<SyncEnrollmentOutput> {
  if (!input.student.cpf) {
    return { messages: ["CPF é necessário"], status: 400 };
  }

  // Consulta se aluno já existe com o CPF como username
  const findUserParams = {
    wstoken: process.env.MOODLE_GET_TOKEN!,
    wsfunction: "core_user_get_users_by_field",
    moodlewsrestformat: "json",
    field: "username",
    "values[0]": input.student.cpf,
  };

  const { result: findUserResult, json: findUserJson } =
    await sendMoodleRequest(findUserParams);

  if (!findUserResult.ok) {
    return { messages: ["Erro ao tentar buscar aluno no Moodle"], status: 500 };
  }

  if (!Array.isArray(findUserJson) || findUserJson.length == 0) {
    return {
      messages: ["Aluno não existente no Moodle."],
      status: 404,
    };
  }

  if (findUserJson.length > 1) {
    return {
      messages: [
        "Erro na resposta do Moodle. Foi retornado mais de um aluno com o CPF informado.",
      ],
      status: 502,
    };
  }

  const studentData: StudentProps = {
    studentId: input.student.id,
    cpf: input.student.cpf,
    actual: {
      email: input.student.email,
      name: input.student.name,
      lastName: input.student.lastName,
    },
    moodle: {
      email: findUserJson[0].email,
      name: findUserJson[0].firstname,
      lastName: findUserJson[0].lastname,
    },
  };

  let messages: string[] = [];

  const message = await updateStudentIfNecessary(studentData);
  messages.push(message);

  const userId = findUserJson[0].id;
  const findCoursesParams = {
    wstoken: process.env.MOODLE_GET_TOKEN!,
    wsfunction: "core_enrol_get_users_courses",
    moodlewsrestformat: "json",
    userid: userId,
  };

  const { result: findCoursesResult, json: findCoursesJson } =
    await sendMoodleRequest(findCoursesParams);

  if (!findCoursesResult.ok) {
    return {
      messages: [
        "Erro ao tentar buscar inscrições do aluno no Moodle",
        ...messages,
      ],
      status: 500,
    };
  }

  if (!Array.isArray(findCoursesJson)) {
    return {
      messages: [
        "Erro na resposta do Moodle, era esperada uma coleção de cursos",
        ...messages,
      ],
      status: 500,
    };
  }

  const index = findCoursesJson.findIndex(
    (course) => course.id == input.course.moodleId
  );

  if (findCoursesJson.length < 1 || index < 0) {
    await updateEnrollmentToSent(input.enrollmentId);
    return {
      messages: [
        "Aluno não matriculado no curso",
        `Situação alterada de ${input.actualStatusType} para Sent`,
        ...messages,
      ],
      status: 404,
    };
  }

  ///
  // const findActivitiesParams = {
  //   wstoken: process.env.MOODLE_GET_TOKEN!,
  //   wsfunction: "core_completion_get_activities_completion_status",
  //   moodlewsrestformat: "json",
  //   userid: userId,
  //   courseid: 2,
  // };

  // const { result: findActivitiesResult, json: findActivitiesJson } =
  //   await sendMoodleRequest(findActivitiesParams);

  // const statuses = findActivitiesJson.statuses;
  // if (Array.isArray(statuses)) {
  //   console.log(
  //     dtFormatter.format(new Date(Number(statuses[0].timecompleted) * 1000))
  //   );
  // }

  // return {
  //   messages: ["Activities", ...messages],
  //   status: 200,
  // }
  const courseLastAccess = findCoursesJson[index].lastaccess;
  const courseProgress = findCoursesJson[index].progress;
  const statusTypeMessages = await updateEnrollmentStatusIfNecessary(
    input.enrollmentId,
    input.actualStatusType,
    input.confirmedAt,
    courseLastAccess,
    courseProgress
  );
  messages = [...messages, ...statusTypeMessages];

  return {
    messages: ["Aluno matriculado", ...messages],
    status: 200,
    courseLastAccess,
    courseProgress,
  };
}
