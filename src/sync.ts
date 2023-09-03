import { prisma } from "./db/connection";
import sendMoodleRequest from "./moodle-request";

const dtFormatter = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "America/Sao_Paulo",
});

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
  enrollmentLastStatusType: string;
  enrollmentLastStatusCreatedAt: Date;
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

async function updateUser(data: StudentProps) {
  // await prisma.student.update({
  //   where: {
  //     id: data.studentId,
  //   },
  //   data: {
  //     email: data.moodle.email,
  //     name: data.moodle.name,
  //     last_name: data.moodle.lastName,
  //   },
  // });
}

async function updateEnrollmentToSent(enrollment_id: string) {
  await prisma.enrollmentStatus.deleteMany({
    where: {
      AND: [
        {
          enrollment_id,
        },
        {
          enrollment_status_type: {
            not: "Sent",
          },
        },
      ],
    },
  });
}

async function updateEnrollmentStatusIfNecessary(
  enrollmentId: string,
  enrollmentStatusType: string,
  enrollmentStatusCreatedAt: Date,
  courseStartDate: Date,
  courseLastAccess: number | null,
  courseCompleted: boolean
): Promise<string[]> {
  let newStatus = "";

  if (courseCompleted) {
    newStatus = "Completed";
  } else {
    if (courseLastAccess !== null) {
      newStatus = "Active";
    } else {
      newStatus = "Confirmed";
    }
  }

  let messages: string[] = [];

  if (enrollmentStatusType === "Confirmed") {
    if (newStatus === "Active") {
      messages = await addEnrollmentStatusToStudent(
        enrollmentId,
        ["Active"],
        courseStartDate
      );
    } else if (newStatus === "Completed") {
      messages = await addEnrollmentStatusToStudent(
        enrollmentId,
        ["Active", "Completed"],
        courseStartDate
      );
    }
  }

  if (enrollmentStatusType === "Active") {
    if (newStatus === "Completed") {
      messages = await addEnrollmentStatusToStudent(
        enrollmentId,
        ["Completed"],
        courseStartDate
      );
    }
  }

  if (enrollmentStatusType === "Completed") {
    if (newStatus === "Confirmed") {
      messages = await removeEnrollmentStatusFromStudent(enrollmentId, [
        "Confirmed",
        "Active",
      ]);
    }
  }

  if (enrollmentStatusType === "Active") {
    if (newStatus === "Confirmed") {
      messages = await removeEnrollmentStatusFromStudent(enrollmentId, [
        "Active",
      ]);
    }
  }

  if (
    enrollmentStatusType === newStatus &&
    enrollmentStatusCreatedAt > courseStartDate
  ) {
    // await prisma.enrollment.update({
    //   where: {
    //     id: enrollmentId,
    //   },
    //   data: {
    //     enrollment_status: {
    //       create: [
    //         {
    //           enrollment_status_type: statusType,
    //           created_at: createdAt,
    //         },
    //       ],
    //     },
    //   },
    // });
    messages = [
      `Data/Hora da situação ${enrollmentStatusType} alterada para ${dtFormatter.format(
        courseStartDate
      )}`,
    ];
  }

  return messages;
}

async function addEnrollmentStatusToStudent(
  enrollmentId: string,
  statusTypes: string[],
  createdAt = new Date()
): Promise<string[]> {
  let messages: string[] = [];
  for (let statusType of statusTypes) {
    // await prisma.enrollment.update({
    //   where: {
    //     id: enrollmentId,
    //   },
    //   data: {
    //     enrollment_status: {
    //       create: [
    //         {
    //           enrollment_status_type: statusType,
    //           created_at: createdAt,
    //         },
    //       ],
    //     },
    //   },
    // });
    messages.push(
      `Adicionada situação ${statusType} em ${dtFormatter.format(createdAt)}`
    );
  }

  return messages;
}

async function removeEnrollmentStatusFromStudent(
  enrollmentId: string,
  statusTypes: string[]
): Promise<string[]> {
  let messages: string[] = [];
  for (let statusType of statusTypes) {
    // await prisma.enrollmentStatus.delete({
    //   where: {
    //     enrollment_status: {
    //       enrollment_id: enrollmentId,
    //       enrollment_status_type: statusType,
    //     },
    //   },
    // });
    messages.push(`Removida situação ${statusType}`);
  }

  return messages;
}

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

  if (!Array.isArray(findUserJson) || findUserJson.length != 1) {
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

  if (
    JSON.stringify(studentData.actual) !== JSON.stringify(studentData.moodle)
  ) {
    await updateUser(studentData);
    messages.push("Dados do aluno atualizado");
  }

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

  if (findCoursesJson.length < 1) {
    updateEnrollmentToSent(input.enrollmentId);
    if (input.enrollmentLastStatusType === "Sent") {
      return {
        messages: [
          "Aluno não matriculado no curso",
          "Situação alterada para Enviado",
          ...messages,
        ],
        status: 404,
      };
    } else {
      return {
        messages: ["Aluno não matriculado no curso", ...messages],
        status: 404,
      };
    }
  }

  const index = findCoursesJson.findIndex(
    (course) => course.id == input.course.moodleId
  );

  if (index < 0) {
    updateEnrollmentToSent(input.enrollmentId);
    if (input.enrollmentLastStatusType === "Sent") {
      return {
        messages: [
          "Aluno não matriculado no curso",
          `Situação alterada de ${input.enrollmentLastStatusType} para Sent`,
          ...messages,
        ],
        status: 404,
      };
    } else {
      return {
        messages: ["Aluno não matriculado no curso", ...messages],
        status: 404,
      };
    }
  }

  ///
  const findActivitiesParams = {
    wstoken: process.env.MOODLE_GET_TOKEN!,
    wsfunction: "core_completion_get_activities_completion_status",
    moodlewsrestformat: "json",
    userid: userId,
    courseid: 2,
  };

  const { result: findActivitiesResult, json: findActivitiesJson } =
    await sendMoodleRequest(findActivitiesParams);

  const statuses = findActivitiesJson.statuses;
  if (Array.isArray(statuses)) {
    console.log(
      dtFormatter.format(new Date(Number(statuses[0].timecompleted) * 1000))
    );
  }

  return {
    messages: ["Activities", ...messages],
    status: 200,
  };
  ///
  const courseStartDate = new Date(
    Number(findCoursesJson[index].startdate) * 1000
  );
  console.log(courseStartDate);
  const courseLastAccess = findCoursesJson[index].lastaccess;
  const courseProgress = findCoursesJson[index].progress;
  const courseCompleted = findCoursesJson[index].completed;
  const statusTypeMessages = await updateEnrollmentStatusIfNecessary(
    input.enrollmentId,
    input.enrollmentLastStatusType,
    input.enrollmentLastStatusCreatedAt,
    courseStartDate,
    courseLastAccess,
    courseCompleted
  );
  messages = [...messages, ...statusTypeMessages];

  return {
    messages: ["Aluno matriculado no curso", ...messages],
    status: 200,
    courseLastAccess,
    courseProgress,
  };
}
