// Written by scripts/open-lectures.mts from Open Yale Courses and archive.org, then read by hand.
// Paths are on Yale's site; audio is Yale's own MP3 or, where those fail, archive.org's copy.
import type { Course } from './course';

export const COURSES: Course[] = [
  {
    id: 'afam-162',
    code: 'AFAM 162',
    title: 'African American History: From Emancipation to the Present (2010)',
    lecturer: 'Jonathan Holloway',
    term: 'Spring 2010',
    department: 'African American Studies',
    page: '/african-american-studies/afam-162',
    description:
      'The purpose of this course is to examine the African American experience in the United States from 1863 to the present (2010). Prominent themes include the end of the Civil War and the beginning of Reconstruction; African Americans’ urbanization experiences; the development of the modern civil rights movement and its aftermath; and the thought and leadership of Booker T. Washington, Ida B. Wells-Barnett, W.E.B. Du Bois, Marcus Garvey, Martin Luther King Jr., and Malcolm X.\n\nWarning: Some of the lectures in this course contain graphic content and/or adult language that some users may find disturbing.\n\nPlease note: This course was captured in 2010.',
    archive: 'oyc_African_American_History',
    host: 'yale',
    lectures: [
      {
        title: 'Dawn of Freedom',
        page: '/african-american-studies/afam-162/lecture-1',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring10/afam162/mp3/afam162_01_011110.mp3',
        durationMs: 2083660,
      },
      {
        title: 'Dawn of Freedom (continued)',
        page: '/african-american-studies/afam-162/lecture-2',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring10/afam162/mp3/afam162_02_011310.mp3',
        durationMs: 2456350,
      },
      {
        title: 'Reconstruction',
        page: '/african-american-studies/afam-162/lecture-3',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring10/afam162/mp3/afam162_03_011510.mp3',
        durationMs: 2926970,
      },
      {
        title: 'Reconstruction (continued)',
        page: '/african-american-studies/afam-162/lecture-4',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring10/afam162/mp3/afam162_04_012010.mp3',
        durationMs: 2829690,
      },
      {
        title: 'Uplift, Accommodation, and Assimilation',
        page: '/african-american-studies/afam-162/lecture-5',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring10/afam162/mp3/afam162_05_012510.mp3',
        durationMs: 2638580,
      },
      {
        title: 'Uplift, Accommodation, and Assimilation (continued)',
        page: '/african-american-studies/afam-162/lecture-6',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring10/afam162/mp3/afam162_06_012710.mp3',
        durationMs: 2842680,
      },
      {
        title: 'Migration and Urbanization',
        page: '/african-american-studies/afam-162/lecture-7',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring10/afam162/mp3/afam162_07_020110.mp3',
        durationMs: 2800780,
      },
      {
        title: 'Migration and Urbanization (continued)',
        page: '/african-american-studies/afam-162/lecture-8',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring10/afam162/mp3/afam162_08_020310.mp3',
        durationMs: 2579340,
      },
      {
        title: 'The New Negroes',
        page: '/african-american-studies/afam-162/lecture-9',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring10/afam162/mp3/afam162_09_020810.mp3',
        durationMs: 2703990,
      },
      {
        title: 'The New Negroes (continued)',
        page: '/african-american-studies/afam-162/lecture-10',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring10/afam162/mp3/afam162_10_021010.mp3',
        durationMs: 3001970,
      },
      {
        title: 'Depression and Double V',
        page: '/african-american-studies/afam-162/lecture-11',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring10/afam162/mp3/afam162_11_021510.mp3',
        durationMs: 2796910,
      },
      {
        title: 'Depression and Double V (continued)',
        page: '/african-american-studies/afam-162/lecture-12',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring10/afam162/mp3/afam162_12_021710.mp3',
        durationMs: 2863160,
      },
      {
        title: 'The Road to Brown and Little Rock',
        page: '/african-american-studies/afam-162/lecture-13',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring10/afam162/mp3/afam162_13_022410.mp3',
        durationMs: 2924650,
      },
      {
        title: 'From Sit-Ins to Civil Rights',
        page: '/african-american-studies/afam-162/lecture-14',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring10/afam162/mp3/afam162_14_030110.mp3',
        durationMs: 2939430,
      },
      {
        title: 'From Sit-Ins to Civil Rights (continued)',
        page: '/african-american-studies/afam-162/lecture-15',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring10/afam162/mp3/afam162_15_030310.mp3',
        durationMs: 2812320,
      },
      {
        title: 'From Voting Rights to Watts',
        page: '/african-american-studies/afam-162/lecture-16',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring10/afam162/mp3/afam162_16_032210.mp3',
        durationMs: 2908690,
      },
      {
        title: 'From Voting Rights to Watts (continued)',
        page: '/african-american-studies/afam-162/lecture-17',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring10/afam162/mp3/afam162_17_032410.mp3',
        durationMs: 2922250,
      },
      {
        title: 'Black Power',
        page: '/african-american-studies/afam-162/lecture-18',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring10/afam162/mp3/afam162_18_032910.mp3',
        durationMs: 2607340,
      },
      {
        title: 'Black Power (continued)',
        page: '/african-american-studies/afam-162/lecture-19',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring10/afam162/mp3/afam162_19_033110.mp3',
        durationMs: 2928780,
      },
      {
        title: 'The Politics of Gender and Culture',
        page: '/african-american-studies/afam-162/lecture-20',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring10/afam162/mp3/afam162_20_040510.mp3',
        durationMs: 2962530,
      },
      {
        title: 'The Politics of Gender and Culture (continued)',
        page: '/african-american-studies/afam-162/lecture-21',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring10/afam162/mp3/afam162_21_040710.mp3',
        durationMs: 2951480,
      },
      {
        title: 'Public Policy and Presidential Politics',
        page: '/african-american-studies/afam-162/lecture-22',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring10/afam162/mp3/afam162_22_041210.mp3',
        durationMs: 2803910,
      },
      {
        title: 'Public Policy and Presidential Politics (continued)',
        page: '/african-american-studies/afam-162/lecture-23',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring10/afam162/mp3/afam162_23_041410.mp3',
        durationMs: 2806710,
      },
      {
        title: 'Who Speaks for the Race?',
        page: '/african-american-studies/afam-162/lecture-24',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring10/afam162/mp3/afam162_24_041910.mp3',
        durationMs: 2939850,
      },
      {
        title: 'Who Speaks for the Race? (continued)',
        page: '/african-american-studies/afam-162/lecture-25',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring10/afam162/mp3/afam162_25_042110.mp3',
        durationMs: 3106410,
      },
    ],
  },
  {
    id: 'amst-246',
    code: 'AMST 246',
    title: 'Hemingway, Fitzgerald, Faulkner',
    lecturer: 'Wai Chee Dimock',
    term: 'Fall 2011',
    department: 'American Studies',
    page: '/american-studies/amst-246',
    description:
      'This course examines major works by Hemingway, Fitzgerald, and Faulkner, exploring their interconnections on three analytic scales: the macro history of the United States and the world; the formal and stylistic innovations of modernism; and the small details of sensory input and psychic life.\n\nWarning: Some of the lectures in this course contain graphic content and/or adult language that some users may find disturbing.',
    archive: 'oyc_Hemingway__Fitzgerald__Faulkner',
    host: 'yale',
    lectures: [
      {
        title: 'Introduction',
        page: '/american-studies/amst-246/lecture-1',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall11/amst246/mp3/amst246_01_090111.mp3',
        durationMs: 2588710,
      },
      {
        title: 'Hemingway’s In Our Time',
        page: '/american-studies/amst-246/lecture-2',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall11/amst246/mp3/amst246_02_090511.mp3',
        durationMs: 2994970,
      },
      {
        title: 'Hemingway’s In Our Time, Part II',
        page: '/american-studies/amst-246/lecture-3',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall11/amst246/mp3/amst246_03_090811.mp3',
        durationMs: 3003670,
      },
      {
        title: 'Fitzgerald’s The Great Gatsby',
        page: '/american-studies/amst-246/lecture-4',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall11/amst246/mp3/amst246_04_091311.mp3',
        durationMs: 2935570,
      },
      {
        title: 'Fitzgerald’s The Great Gatsby, Part II',
        page: '/american-studies/amst-246/lecture-5',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall11/amst246/mp3/amst246_05_091511.mp3',
        durationMs: 3008580,
      },
      {
        title: 'Faulkner’s The Sound and the Fury',
        page: '/american-studies/amst-246/lecture-6',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall11/amst246/mp3/amst246_06_092011.mp3',
        durationMs: 3006310,
      },
      {
        title: 'Faulkner’s The Sound and the Fury, Part II',
        page: '/american-studies/amst-246/lecture-7',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall11/amst246/mp3/amst246_07_092211.mp3',
        durationMs: 2900930,
      },
      {
        title: 'Faulkner’s The Sound and the Fury, Part III',
        page: '/american-studies/amst-246/lecture-8',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall11/amst246/mp3/amst246_08_092711.mp3',
        durationMs: 2758480,
      },
      {
        title: 'Faulkner’s The Sound and the Fury, Part IV',
        page: '/american-studies/amst-246/lecture-9',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall11/amst246/mp3/amst246_09_092911.mp3',
        durationMs: 3063330,
      },
      {
        title: 'Hemingway’s To Have and Have Not',
        page: '/american-studies/amst-246/lecture-10',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall11/amst246/mp3/amst246_10_100411.mp3',
        durationMs: 2911900,
      },
      {
        title: 'Hemingway’s To Have and Have Not, Part II',
        page: '/american-studies/amst-246/lecture-11',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall11/amst246/mp3/amst246_11_100611.mp3',
        durationMs: 2898890,
      },
      {
        title: 'Fitzgerald’s Short Stories',
        page: '/american-studies/amst-246/lecture-12',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall11/amst246/mp3/amst246_12_101111.mp3',
        durationMs: 2969210,
      },
      {
        title: 'Faulkner’s As I Lay Dying',
        page: '/american-studies/amst-246/lecture-13',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall11/amst246/mp3/amst246_13_101311.mp3',
        durationMs: 2897510,
      },
      {
        title: 'Faulkner’s As I Lay Dying, Part II',
        page: '/american-studies/amst-246/lecture-14',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall11/amst246/mp3/amst246_14_101811.mp3',
        durationMs: 2912970,
      },
      {
        title: 'Faulkner’s As I Lay Dying, Part III',
        page: '/american-studies/amst-246/lecture-15',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall11/amst246/mp3/amst246_15_102011.mp3',
        durationMs: 2989380,
      },
      {
        title: 'Hemingway’s For Whom the Bell Tolls',
        page: '/american-studies/amst-246/lecture-16',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall11/amst246/mp3/amst246_16_102511.mp3',
        durationMs: 2921250,
      },
      {
        title: 'Hemingway’s For Whom the Bell Tolls, Part II',
        page: '/american-studies/amst-246/lecture-17',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall11/amst246/mp3/amst246_17_102711.mp3',
        durationMs: 2734480,
      },
      {
        title: 'Hemingway’s For Whom the Bell Tolls, Part III',
        page: '/american-studies/amst-246/lecture-18',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall11/amst246/mp3/amst246_18_110111.mp3',
        durationMs: 2838730,
      },
      {
        title: 'Hemingway’s For Whom the Bell Tolls, Part IV',
        page: '/american-studies/amst-246/lecture-19',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall11/amst246/mp3/amst246_19_110311.mp3',
        durationMs: 2946020,
      },
      {
        title: 'Fitzgerald’s Tender Is the Night',
        page: '/american-studies/amst-246/lecture-20',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall11/amst246/mp3/amst246_20_110811.mp3',
        durationMs: 2828150,
      },
      {
        title: 'Fitzgerald’s Tender is the Night, Part II',
        page: '/american-studies/amst-246/lecture-21',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall11/amst246/mp3/amst246_21_111011.mp3',
        durationMs: 3063460,
      },
      {
        title: 'Faulkner’s Light in August',
        page: '/american-studies/amst-246/lecture-22',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall11/amst246/mp3/amst246_22_111511.mp3',
        durationMs: 2969840,
      },
      {
        title: 'Faulkner’s Light in August, Part II',
        page: '/american-studies/amst-246/lecture-23',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall11/amst246/mp3/amst246_23_111711.mp3',
        durationMs: 2994060,
      },
      {
        title: 'Faulkner’s Light in August, Part III',
        page: '/american-studies/amst-246/lecture-24',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall11/amst246/mp3/amst246_24_112911.mp3',
        durationMs: 3056800,
      },
      {
        title: 'Faulkner’s Light in August, Part IV',
        page: '/american-studies/amst-246/lecture-25',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall11/amst246/mp3/amst246_25_120211.mp3',
        durationMs: 2912060,
      },
    ],
  },
  {
    id: 'astr-160',
    code: 'ASTR 160',
    title: 'Frontiers and Controversies in Astrophysics',
    lecturer: 'Charles Bailyn',
    term: 'Spring 2007',
    department: 'Astronomy',
    page: '/astronomy/astr-160',
    description:
      'This course focuses on three particularly interesting areas of astronomy that are advancing very rapidly: Extra-Solar Planets, Black Holes, and Dark Energy. Particular attention is paid to current projects that promise to improve our understanding significantly over the next few years. The course explores not just what is known, but what is currently not known, and how astronomers are going about trying to find out.',
    archive: 'oyc_Frontiers_and_Controversies_in_Astrophysics',
    host: 'yale',
    lectures: [
      {
        title: 'Introduction',
        page: '/astronomy/astr-160/lecture-1',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring07/astr160/mp3/astr160_01_011607.mp3',
        durationMs: 2799630,
      },
      {
        title: 'Planetary Orbits',
        page: '/astronomy/astr-160/lecture-2',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring07/astr160/mp3/astr160_02_011807.mp3',
        durationMs: 3082980,
      },
      {
        title: 'Our Solar System and the Pluto Problem',
        page: '/astronomy/astr-160/lecture-3',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring07/astr160/mp3/astr160_03_012307.mp3',
        durationMs: 2754720,
      },
      {
        title: 'Discovering Exoplanets: Hot Jupiters',
        page: '/astronomy/astr-160/lecture-4',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring07/astr160/mp3/astr160_04_012507.mp3',
        durationMs: 2800440,
      },
      {
        title: 'Planetary Transits',
        page: '/astronomy/astr-160/lecture-5',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring07/astr160/mp3/astr160_05_013007.mp3',
        durationMs: 2961170,
      },
      {
        title: 'Microlensing, Astrometry and Other Methods',
        page: '/astronomy/astr-160/lecture-6',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring07/astr160/mp3/astr160_06_020107.mp3',
        durationMs: 2847170,
      },
      {
        title: 'Direct Imaging of Exoplanets',
        page: '/astronomy/astr-160/lecture-7',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring07/astr160/mp3/astr160_07_020607.mp3',
        durationMs: 2825120,
      },
      {
        title: 'Update 1: The Kepler Mission',
        page: '/astronomy/astr-160/update-1',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring07/astr160/mp3/astr160_update01_070212.mp3',
        durationMs: 1547180,
      },
      {
        title: 'Introduction to Black Holes',
        page: '/astronomy/astr-160/lecture-8',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring07/astr160/mp3/astr160_08_021307.mp3',
        durationMs: 2643150,
      },
      {
        title: 'Special and General Relativity',
        page: '/astronomy/astr-160/lecture-9',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring07/astr160/mp3/astr160_09_021507.mp3',
        durationMs: 2879850,
      },
      {
        title: 'Tests of Relativity',
        page: '/astronomy/astr-160/lecture-10',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring07/astr160/mp3/astr160_10_022007.mp3',
        durationMs: 2690200,
      },
      {
        title: 'Special and General Relativity (cont.)',
        page: '/astronomy/astr-160/lecture-11',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring07/astr160/mp3/astr160_11_022207.mp3',
        durationMs: 2459070,
      },
      {
        title: 'Stellar Mass Black Holes',
        page: '/astronomy/astr-160/lecture-12',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring07/astr160/mp3/astr160_12_022707.mp3',
        durationMs: 2982040,
      },
      {
        title: 'Stellar Mass Black Holes (cont.)',
        page: '/astronomy/astr-160/lecture-13',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring07/astr160/mp3/astr160_13_030107.mp3',
        durationMs: 2941650,
      },
      {
        title: 'Pulsars',
        page: '/astronomy/astr-160/lecture-14',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring07/astr160/mp3/astr160_14_030607.mp3',
        durationMs: 2919710,
      },
      {
        title: 'Supermassive Black Holes',
        page: '/astronomy/astr-160/lecture-15',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring07/astr160/mp3/astr160_15_030807.mp3',
        durationMs: 2857570,
      },
      {
        title: 'Update 2: Do Black Holes Spin?',
        page: '/astronomy/astr-160/update-2',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring07/astr160/mp3/astr160_update02_070212.mp3',
        durationMs: 1739703,
      },
      {
        title: 'Hubble’s Law and the Big Bang',
        page: '/astronomy/astr-160/lecture-16',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring07/astr160/mp3/astr160_16_032907.mp3',
        durationMs: 3048630,
      },
      {
        title: 'Hubble’s Law and the Big Bang (cont.)',
        page: '/astronomy/astr-160/lecture-17',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring07/astr160/mp3/astr160_17_040307.mp3',
        durationMs: 3110770,
      },
      {
        title: 'Hubble’s Law and the Big Bang (cont.)',
        page: '/astronomy/astr-160/lecture-18',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring07/astr160/mp3/astr160_18_040507.mp3',
        durationMs: 3012680,
      },
      {
        title: 'Omega and the End of the Universe',
        page: '/astronomy/astr-160/lecture-19',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring07/astr160/mp3/astr160_19_041007.mp3',
        durationMs: 2949750,
      },
      {
        title: 'Dark Matter',
        page: '/astronomy/astr-160/lecture-20',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring07/astr160/mp3/astr160_20_041207.mp3',
        durationMs: 2976840,
      },
      {
        title: 'Dark Energy and the Accelerating Universe and the Big Rip',
        page: '/astronomy/astr-160/lecture-21',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring07/astr160/mp3/astr160_21_041707.mp3',
        durationMs: 2747620,
      },
      {
        title: 'Supernovae',
        page: '/astronomy/astr-160/lecture-22',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring07/astr160/mp3/astr160_22_041907.mp3',
        durationMs: 2813450,
      },
      {
        title: 'Other Constraints: The Cosmic Microwave Background',
        page: '/astronomy/astr-160/lecture-23',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring07/astr160/mp3/astr160_23_042407.mp3',
        durationMs: 2827760,
      },
      {
        title: 'The Multiverse and Theories of Everything',
        page: '/astronomy/astr-160/lecture-24',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring07/astr160/mp3/astr160_24_042607.mp3',
        durationMs: 2805870,
      },
      {
        title: 'Update 3: The “Dark Ages” and the Growth of Structure',
        page: '/astronomy/astr-160/update-3',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring07/astr160/mp3/astr160_update03_070212.mp3',
        durationMs: 1903935,
      },
    ],
  },
  {
    id: 'beng-100',
    code: 'BENG 100',
    title: 'Frontiers of Biomedical Engineering',
    lecturer: 'W. Mark Saltzman',
    term: 'Spring 2008',
    department: 'Biomedical Engineering',
    page: '/biomedical-engineering/beng-100',
    description:
      'The course covers basic concepts of biomedical engineering and their connection with the spectrum of human activity. It serves as an introduction to the fundamental science and engineering on which biomedical engineering is based. Case studies of drugs and medical products illustrate the product development-product testing cycle, patent protection, and FDA approval. It is designed for science and non-science majors.',
    archive: 'oyc_Frontiers_of_Biomedical_Engineering',
    host: 'yale',
    lectures: [
      {
        title: 'What Is Biomedical Engineering?',
        page: '/biomedical-engineering/beng-100/lecture-1',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring08/beng100/mp3/beng100_01_011508.mp3',
        durationMs: 2537960,
      },
      {
        title: 'What Is Biomedical Engineering? (cont.)',
        page: '/biomedical-engineering/beng-100/lecture-2',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring08/beng100/mp3/beng100_02_011708.mp3',
        durationMs: 2615280,
      },
      {
        title: 'Genetic Engineering',
        page: '/biomedical-engineering/beng-100/lecture-3',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring08/beng100/mp3/beng100_03_012208.mp3',
        durationMs: 2796000,
      },
      {
        title: 'Genetic Engineering (cont.)',
        page: '/biomedical-engineering/beng-100/lecture-4',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring08/beng100/mp3/beng100_04_012408.mp3',
        durationMs: 3091600,
      },
      {
        title: 'Cell Culture Engineering',
        page: '/biomedical-engineering/beng-100/lecture-5',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring08/beng100/mp3/beng100_05_012908.mp3',
        durationMs: 3141200,
      },
      {
        title: 'Cell Culture Engineering (cont.)',
        page: '/biomedical-engineering/beng-100/lecture-6',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring08/beng100/mp3/beng100_06_013108.mp3',
        durationMs: 2888000,
      },
      {
        title: 'Cell Communication and Immunology',
        page: '/biomedical-engineering/beng-100/lecture-7',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring08/beng100/mp3/beng100_07_020508.mp3',
        durationMs: 2794040,
      },
      {
        title: 'Cell Communication and Immunology (cont.)',
        page: '/biomedical-engineering/beng-100/lecture-8',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring08/beng100/mp3/beng100_08_020708.mp3',
        durationMs: 2981650,
      },
      {
        title: 'Biomolecular Engineering: Engineering of Immunity',
        page: '/biomedical-engineering/beng-100/lecture-9',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring08/beng100/mp3/beng100_09_021208.mp3',
        durationMs: 2792830,
      },
      {
        title: 'Biomolecular Engineering: Engineering of Immunity (cont.)',
        page: '/biomedical-engineering/beng-100/lecture-10',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring08/beng100/mp3/beng100_10_021408.mp3',
        durationMs: 3157740,
      },
      {
        title: 'Biomolecular Engineering: General Concepts',
        page: '/biomedical-engineering/beng-100/lecture-11',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring08/beng100/mp3/beng100_11_021908.mp3',
        durationMs: 3157370,
      },
      {
        title: 'Biomolecular Engineering: General Concepts (cont.)',
        page: '/biomedical-engineering/beng-100/lecture-12',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring08/beng100/mp3/beng100_12_022108.mp3',
        durationMs: 2847770,
      },
      {
        title: 'Cardiovascular Physiology',
        page: '/biomedical-engineering/beng-100/lecture-13',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring08/beng100/mp3/beng100_13_022608.mp3',
        durationMs: 3020880,
      },
      {
        title: 'Cardiovascular Physiology (cont.)',
        page: '/biomedical-engineering/beng-100/lecture-14',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring08/beng100/mp3/beng100_14_022808.mp3',
        durationMs: 2374170,
      },
      {
        title: 'Cardiovascular Physiology (cont.)',
        page: '/biomedical-engineering/beng-100/lecture-15',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring08/beng100/mp3/beng100_15_030408.mp3',
        durationMs: 2756160,
      },
      {
        title: 'Renal Physiology',
        page: '/biomedical-engineering/beng-100/lecture-16',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring08/beng100/mp3/beng100_16_032508.mp3',
        durationMs: 3062080,
      },
      {
        title: 'Renal Physiology (cont.)',
        page: '/biomedical-engineering/beng-100/lecture-17',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring08/beng100/mp3/beng100_17_032708.mp3',
        durationMs: 2665250,
      },
      {
        title: 'Biomechanics and Orthopedics',
        page: '/biomedical-engineering/beng-100/lecture-18',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring08/beng100/mp3/beng100_18_040108.mp3',
        durationMs: 2663890,
      },
      {
        title: 'Biomechanics and Orthopedics (cont.)',
        page: '/biomedical-engineering/beng-100/lecture-19',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring08/beng100/mp3/beng100_19_040308.mp3',
        durationMs: 3114380,
      },
      {
        title: 'Bioimaging',
        page: '/biomedical-engineering/beng-100/lecture-20',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring08/beng100/mp3/beng100_20_040808.mp3',
        durationMs: 2279610,
      },
      {
        title: 'Bioimaging (cont.)',
        page: '/biomedical-engineering/beng-100/lecture-21',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring08/beng100/mp3/beng100_21_041008.mp3',
        durationMs: 3226830,
      },
      {
        title: 'Tissue Engineering',
        page: '/biomedical-engineering/beng-100/lecture-22',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring08/beng100/mp3/beng100_22_041508.mp3',
        durationMs: 2995620,
      },
      {
        title: 'Tissue Engineering (cont.)',
        page: '/biomedical-engineering/beng-100/lecture-23',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring08/beng100/mp3/beng100_23_041708.mp3',
        durationMs: 2508410,
      },
      {
        title: 'Biomedical Engineers and Cancer',
        page: '/biomedical-engineering/beng-100/lecture-24',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring08/beng100/mp3/beng100_24_042208.mp3',
        durationMs: 2865510,
      },
      {
        title: 'Biomedical Engineers and Artificial Organs',
        page: '/biomedical-engineering/beng-100/lecture-25',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring08/beng100/mp3/beng100_25_042408.mp3',
        durationMs: 3023500,
      },
    ],
  },
  {
    id: 'chem-125a',
    code: 'CHEM 125a',
    title: 'Freshman Organic Chemistry I',
    lecturer: 'J. Michael McBride',
    term: 'Fall 2008',
    department: 'Chemistry',
    page: '/chemistry/chem-125a',
    description:
      'This is the first semester in a two-semester introductory course focused on current theories of structure and mechanism in organic chemistry, their historical development, and their basis in experimental observation. The course is open to freshmen with excellent preparation in chemistry and physics, and it aims to develop both taste for original science and intellectual skills necessary for creative research.',
    archive: 'oyc_Freshman_Organic_Chemistry_I',
    host: 'yale',
    lectures: [
      {
        title: 'How Do You Know?',
        page: '/chemistry/chem-125a/lecture-1',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall08/chem125/mp3/chem125_01_090308.mp3',
        durationMs: 2800310,
      },
      {
        title: 'Force Laws, Lewis Structures and Resonance',
        page: '/chemistry/chem-125a/lecture-2',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall08/chem125/mp3/chem125_02_090508.mp3',
        durationMs: 3012290,
      },
      {
        title: 'Double Minima, Earnshaw’s Theorem and Plum-Puddings',
        page: '/chemistry/chem-125a/lecture-3',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall08/chem125/mp3/chem125_03_090808.mp3',
        durationMs: 2702900,
      },
      {
        title: 'Coping with Smallness and Scanning Probe Microscopy',
        page: '/chemistry/chem-125a/lecture-4',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall08/chem125/mp3/chem125_04_091008.mp3',
        durationMs: 3001370,
      },
      {
        title: 'X-Ray Diffraction',
        page: '/chemistry/chem-125a/lecture-5',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall08/chem125/mp3/chem125_05_091208.mp3',
        durationMs: 2829930,
      },
      {
        title: 'Seeing Bonds by Electron Difference Density',
        page: '/chemistry/chem-125a/lecture-6',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall08/chem125/mp3/chem125_06_091508.mp3',
        durationMs: 3070150,
      },
      {
        title: 'Quantum Mechanical Kinetic Energy',
        page: '/chemistry/chem-125a/lecture-7',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall08/chem125/mp3/chem125_07_091708.mp3',
        durationMs: 2957800,
      },
      {
        title: 'One-Dimensional Wave Functions',
        page: '/chemistry/chem-125a/lecture-8',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall08/chem125/mp3/chem125_08_091908.mp3',
        durationMs: 2990320,
      },
      {
        title: 'Chladni Figures and One-Electron Atoms',
        page: '/chemistry/chem-125a/lecture-9',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall08/chem125/mp3/chem125_09_092208.mp3',
        durationMs: 2975720,
      },
      {
        title: 'Reality and the Orbital Approximation',
        page: '/chemistry/chem-125a/lecture-10',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall08/chem125/mp3/chem125_10_092408.mp3',
        durationMs: 2913390,
      },
      {
        title: 'Orbital Correction and Plum-Pudding Molecules',
        page: '/chemistry/chem-125a/lecture-11',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall08/chem125/mp3/chem125_11_092908.mp3',
        durationMs: 2966940,
      },
      {
        title: 'Overlap and Atom-Pair Bonds',
        page: '/chemistry/chem-125a/lecture-12',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall08/chem125/mp3/chem125_12_100108.mp3',
        durationMs: 3034700,
      },
      {
        title: 'Overlap and Energy-Match',
        page: '/chemistry/chem-125a/lecture-13',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall08/chem125/mp3/chem125_13_100308.mp3',
        durationMs: 2983840,
      },
      {
        title: 'Checking Hybridization Theory with XH3',
        page: '/chemistry/chem-125a/lecture-14',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall08/chem125/mp3/chem125_14_100608.mp3',
        durationMs: 2856180,
      },
      {
        title: 'Chemical Reactivity: SOMO, HOMO, and LUMO',
        page: '/chemistry/chem-125a/lecture-15',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall08/chem125/mp3/chem125_15_100808.mp3',
        durationMs: 2831520,
      },
      {
        title: 'Recognizing Functional Groups',
        page: '/chemistry/chem-125a/lecture-16',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall08/chem125/mp3/chem125_16_101008.mp3',
        durationMs: 3008140,
      },
      {
        title: 'Reaction Analogies and Carbonyl Reactivity',
        page: '/chemistry/chem-125a/lecture-17',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall08/chem125/mp3/chem125_17_101308.mp3',
        durationMs: 2503660,
      },
      {
        title: 'Amide, Carboxylic Acid and Alkyl Lithium',
        page: '/chemistry/chem-125a/lecture-18',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall08/chem125/mp3/chem125_18_101508.mp3',
        durationMs: 3080470,
      },
      {
        title: 'Oxygen and the Chemical Revolution (Beginning to 1789)',
        page: '/chemistry/chem-125a/lecture-19',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall08/chem125/mp3/chem125_19_101708.mp3',
        durationMs: 2829900,
      },
      {
        title: 'Rise of the Atomic Theory (1790-1805)',
        page: '/chemistry/chem-125a/lecture-20',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall08/chem125/mp3/chem125_20_102208.mp3',
        durationMs: 3000270,
      },
      {
        title: 'Berzelius to Liebig and Wöhler (1805-1832)',
        page: '/chemistry/chem-125a/lecture-21',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall08/chem125/mp3/chem125_21_102408.mp3',
        durationMs: 2961270,
      },
      {
        title: 'Radical and Type Theories (1832-1850)',
        page: '/chemistry/chem-125a/lecture-22',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall08/chem125/mp3/chem125_22_102708.mp3',
        durationMs: 2954380,
      },
      {
        title: 'Valence Theory and Constitutional Structure (1858)',
        page: '/chemistry/chem-125a/lecture-23',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall08/chem125/mp3/chem125_23_102908.mp3',
        durationMs: 2926220,
      },
      {
        title: 'Determining Chemical Structure by Isomer Counting (1869)',
        page: '/chemistry/chem-125a/lecture-24',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall08/chem125/mp3/chem125_24_103108.mp3',
        durationMs: 3014930,
      },
      {
        title: 'Models in 3D Space (1869-1877); Optical Isomers',
        page: '/chemistry/chem-125a/lecture-25',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall08/chem125/mp3/chem125_25_110308.mp3',
        durationMs: 2942070,
      },
      {
        title: 'Van’t Hoff’s Tetrahedral Carbon and Chirality',
        page: '/chemistry/chem-125a/lecture-26',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall08/chem125/mp3/chem125_26_110508.mp3',
        durationMs: 2906210,
      },
      {
        title: 'Communicating Molecular Structure in Diagrams and Words',
        page: '/chemistry/chem-125a/lecture-27',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall08/chem125/mp3/chem125_27_110708.mp3',
        durationMs: 3095460,
      },
      {
        title: 'Stereochemical Nomenclature; Racemization and Resolution',
        page: '/chemistry/chem-125a/lecture-28',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall08/chem125/mp3/chem125_28_111008.mp3',
        durationMs: 2849810,
      },
      {
        title: 'Preparing Single Enantiomers and the Mechanism of Optical Rotation',
        page: '/chemistry/chem-125a/lecture-29',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall08/chem125/mp3/chem125_29_111208.mp3',
        durationMs: 3018950,
      },
      {
        title: 'Esomeprazole as an Example of Drug Testing and Usage',
        page: '/chemistry/chem-125a/lecture-30',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall08/chem125/mp3/chem125_30_111708.mp3',
        durationMs: 3042640,
      },
      {
        title: 'Preparing Single Enantiomers and Conformational Energy',
        page: '/chemistry/chem-125a/lecture-31',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall08/chem125/mp3/chem125_31_111908.mp3',
        durationMs: 2932800,
      },
      {
        title: 'Stereotopicity and Baeyer Strain Theory',
        page: '/chemistry/chem-125a/lecture-32',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall08/chem125/mp3/chem125_32_112108.mp3',
        durationMs: 2777580,
      },
      {
        title: 'Conformational Energy and Molecular Mechanics',
        page: '/chemistry/chem-125a/lecture-33',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall08/chem125/mp3/chem125_33_120108.mp3',
        durationMs: 2872590,
      },
      {
        title: 'Sharpless Oxidation Catalysts and the Conformation of Cycloalkanes',
        page: '/chemistry/chem-125a/lecture-34',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall08/chem125/mp3/chem125_34_120308.mp3',
        durationMs: 2957560,
      },
      {
        title: 'Understanding Molecular Structure and Energy through Standard Bonds',
        page: '/chemistry/chem-125a/lecture-35',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall08/chem125/mp3/chem125_35_120508.mp3',
        durationMs: 2921570,
      },
      {
        title: 'Bond Energies, the Boltzmann Factor and Entropy',
        page: '/chemistry/chem-125a/lecture-36',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall08/chem125/mp3/chem125_36_120808.mp3',
        durationMs: 2870780,
      },
      {
        title: 'Potential Energy Surfaces, Transition State Theory and Reaction Mechanism',
        page: '/chemistry/chem-125a/lecture-37',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall08/chem125/mp3/chem125_37_121008.mp3',
        durationMs: 2864040,
      },
    ],
  },
  {
    id: 'chem-125b',
    code: 'CHEM 125b',
    title: 'Freshman Organic Chemistry II',
    lecturer: 'J. Michael McBride',
    term: 'Spring 2011',
    department: 'Chemistry',
    page: '/chemistry/chem-125b',
    description:
      'This is a continuation of Freshman Organic Chemistry I (CHEM 125a), the introductory course on current theories of structure and mechanism in organic chemistry for students with excellent preparation in chemistry and physics. This semester treats simple and complex reaction mechanisms, spectroscopy, organic synthesis, and some molecules of nature.',
    archive: 'oyc_Freshman_Organic_Chemistry_II',
    host: 'yale',
    lectures: [
      {
        title: 'Mechanism: How Energies and Kinetic Order Influence Reaction Rates',
        page: '/chemistry/chem-125b/lecture-1',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring11/chem125b/mp3/chem125_01_011011.mp3',
        durationMs: 2939980,
      },
      {
        title: 'Peculiar Rate Laws, Bond Dissociation Energies, and Relative Reactivities',
        page: '/chemistry/chem-125b/lecture-2',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring11/chem125b/mp3/chem125_02_011211.mp3',
        durationMs: 2893300,
      },
      {
        title: 'Rate and Selectivity in Radical-Chain Reactions',
        page: '/chemistry/chem-125b/lecture-3',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring11/chem125b/mp3/chem125_03_011411.mp3',
        durationMs: 2805710,
      },
      {
        title: 'Electronegativity, Bond Strength, Electrostatics, and Non-Bonded Interactions',
        page: '/chemistry/chem-125b/lecture-4',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring11/chem125b/mp3/chem125_04_011911.mp3',
        durationMs: 3007870,
      },
      {
        title: 'Solvation, H-Bonding, and Ionophores',
        page: '/chemistry/chem-125b/lecture-5',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring11/chem125b/mp3/chem125_05_012111.mp3',
        durationMs: 2829280,
      },
      {
        title: 'Brønsted Acidity and the Generality of Nucleophilic Substitution',
        page: '/chemistry/chem-125b/lecture-6',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring11/chem125b/mp3/chem125_06_012411.mp3',
        durationMs: 2806580,
      },
      {
        title:
          'Nucleophilic Substitution Tools - Stereochemistry, Rate Law, Substrate, Nucleophile, Leaving Group',
        page: '/chemistry/chem-125b/lecture-7',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring11/chem125b/mp3/chem125_07_012611.mp3',
        durationMs: 3115710,
      },
      {
        title: 'Solvent, Leaving Group, Bridgehead Substitution, and Pentavalent Carbon',
        page: '/chemistry/chem-125b/lecture-8',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring11/chem125b/mp3/chem125_08_012811.mp3',
        durationMs: 2906910,
      },
      {
        title: 'Pentavalent Carbon? E2, SN1, E1',
        page: '/chemistry/chem-125b/lecture-9',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring11/chem125b/mp3/chem125_09_013111.mp3',
        durationMs: 2884920,
      },
      {
        title: 'Cation Intermediates – Alkenes: Formation, Addition, and Stability',
        page: '/chemistry/chem-125b/lecture-10',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring11/chem125b/mp3/chem125_10_020211.mp3',
        durationMs: 3075090,
      },
      {
        title: 'Carbocations and the Mechanism of Electrophilic Addition to Alkenes and Alkynes',
        page: '/chemistry/chem-125b/lecture-11',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring11/chem125b/mp3/chem125_11_020711.mp3',
        durationMs: 3127590,
      },
      {
        title:
          'Nucleophilic Participation During Electrophilic Addition to Alkenes: Halogen, Carbene, and Borane',
        page: '/chemistry/chem-125b/lecture-12',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring11/chem125b/mp3/chem125_12_020911.mp3',
        durationMs: 2944320,
      },
      {
        title: 'Addition to Form Three-Membered Rings: Carbenoids and Epoxidation',
        page: '/chemistry/chem-125b/lecture-13',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring11/chem125b/mp3/chem125_13_021111.mp3',
        durationMs: 3055000,
      },
      {
        title: 'Epoxide Opening, Dipolar Cycloaddition, and Ozonolysis',
        page: '/chemistry/chem-125b/lecture-14',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring11/chem125b/mp3/chem125_14_021411.mp3',
        durationMs: 2978750,
      },
      {
        title:
          'Metals and Catalysis in Alkene Oxidation, Hydrogenation, Metathesis, and Polymerization',
        page: '/chemistry/chem-125b/lecture-15',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring11/chem125b/mp3/chem125_15_021611.mp3',
        durationMs: 3035640,
      },
      {
        title: 'Isoprenoids, Rubber, and Tuning Polymer Properties',
        page: '/chemistry/chem-125b/lecture-16',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring11/chem125b/mp3/chem125_16_021811.mp3',
        durationMs: 2786230,
      },
      {
        title: 'Alkynes; Conjugation in Allylic Intermediates and Dienes',
        page: '/chemistry/chem-125b/lecture-17',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring11/chem125b/mp3/chem125_17_022111.mp3',
        durationMs: 2977150,
      },
      {
        title: 'Linear and Cyclic Conjugation Theory; 4n+2 Aromaticity',
        page: '/chemistry/chem-125b/lecture-18',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring11/chem125b/mp3/chem125_18_022311.mp3',
        durationMs: 2866110,
      },
      {
        title: 'Aromatic Transition States: Cycloaddition and Electrocyclic Reactions',
        page: '/chemistry/chem-125b/lecture-19',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring11/chem125b/mp3/chem125_19_022511.mp3',
        durationMs: 2952210,
      },
      {
        title: 'Electronic and Vibrational Spectroscopy',
        page: '/chemistry/chem-125b/lecture-20',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring11/chem125b/mp3/chem125_20_030211.mp3',
        durationMs: 2986980,
      },
      {
        title:
          'Functional Groups and Fingerprints in IR Spectroscopy; Precession of Magnetic Nuclei',
        page: '/chemistry/chem-125b/lecture-21',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring11/chem125b/mp3/chem125_21_030411.mp3',
        durationMs: 3218680,
      },
      {
        title: 'Medical MRI and Chemical NMR',
        page: '/chemistry/chem-125b/lecture-22',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring11/chem125b/mp3/chem125_22_032111.mp3',
        durationMs: 2960720,
      },
      {
        title: 'Diamagnetic Anisotropy and Spin-Spin Splitting',
        page: '/chemistry/chem-125b/lecture-23',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring11/chem125b/mp3/chem125_23_032311.mp3',
        durationMs: 2899620,
      },
      {
        title: 'Higher-Order Effects, Dynamics, and the NMR Time Scale',
        page: '/chemistry/chem-125b/lecture-24',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring11/chem125b/mp3/chem125_24_032511.mp3',
        durationMs: 3072240,
      },
      {
        title: 'C-13 and 2D NMR – Electrophilic Aromatic Substitution',
        page: '/chemistry/chem-125b/lecture-25',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring11/chem125b/mp3/chem125_25_032811.mp3',
        durationMs: 3028220,
      },
      {
        title: 'Aromatic Substitution in Synthesis: Friedel-Crafts and Moses Gomberg',
        page: '/chemistry/chem-125b/lecture-26',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring11/chem125b/mp3/chem125_26_033011.mp3',
        durationMs: 3048340,
      },
      {
        title: 'Triphenylmethyl and an Introduction to Carbonyl Chemistry',
        page: '/chemistry/chem-125b/lecture-27',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring11/chem125b/mp3/chem125_27_040111.mp3',
        durationMs: 2733460,
      },
      {
        title: 'Mechanism and Equilibrium of Carbonyl Reactions',
        page: '/chemistry/chem-125b/lecture-28',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring11/chem125b/mp3/chem125_28_040411.mp3',
        durationMs: 2944080,
      },
      {
        title: 'Imines and Enamines; Oxidation and Reduction',
        page: '/chemistry/chem-125b/lecture-29',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring11/chem125b/mp3/chem125_29_040611.mp3',
        durationMs: 3001870,
      },
      {
        title: 'Oxidation States and Mechanisms',
        page: '/chemistry/chem-125b/lecture-30',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring11/chem125b/mp3/chem125_30_041111.mp3',
        durationMs: 2817760,
      },
      {
        title: 'Periodate Cleavage, Retrosynthesis, and Green Chemistry',
        page: '/chemistry/chem-125b/lecture-31',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring11/chem125b/mp3/chem125_31_041311.mp3',
        durationMs: 2767500,
      },
      {
        title: 'Measuring Bond Energies: Guest Lecture by Prof. G. Barney Ellison',
        page: '/chemistry/chem-125b/lecture-32',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring11/chem125b/mp3/chem125_32_041511.mp3',
        durationMs: 2852660,
      },
      {
        title: 'Green Chemistry; Acids and Acid Derivatives',
        page: '/chemistry/chem-125b/lecture-33',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring11/chem125b/mp3/chem125_33_041811.mp3',
        durationMs: 2959710,
      },
      {
        title: 'Acids and Acid Derivatives',
        page: '/chemistry/chem-125b/lecture-34',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring11/chem125b/mp3/chem125_34_042011.mp3',
        durationMs: 3028330,
      },
      {
        title: 'Acyl Insertions and α-Reactivity',
        page: '/chemistry/chem-125b/lecture-35',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring11/chem125b/mp3/chem125_35_042211.mp3',
        durationMs: 2928590,
      },
      {
        title: 'α-Reactivity and Condensation Reactions',
        page: '/chemistry/chem-125b/lecture-36',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring11/chem125b/mp3/chem125_36_042511.mp3',
        durationMs: 3186920,
      },
      {
        title: 'Proving the Configuration of Glucose and Synthesizing Two Unnatural Products',
        page: '/chemistry/chem-125b/lecture-37',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring11/chem125b/mp3/chem125_37_042711.mp3',
        durationMs: 3286390,
      },
      {
        title: 'Review: Synthesis of Cortisone',
        page: '/chemistry/chem-125b/lecture-38',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring11/chem125b/mp3/chem125_38_042911.mp3',
        durationMs: 3129140,
      },
    ],
  },
  {
    id: 'clcv-205',
    code: 'CLCV 205',
    title: 'Introduction to Ancient Greek History',
    lecturer: 'Donald Kagan',
    term: 'Fall 2007',
    department: 'Classics',
    page: '/classics/clcv-205',
    description:
      'This is an introductory course in Greek history tracing the development of Greek civilization as manifested in political, intellectual, and creative achievements from the Bronze Age to the end of the classical period. Students read original sources in translation as well as the works of modern scholars.',
    archive: 'oyc_Introduction_to_Ancient_Greek_History',
    host: 'yale',
    lectures: [
      {
        title: 'Introduction',
        page: '/classics/clcv-205/lecture-1',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall07/clcv205/mp3/clcv205_01_090607.mp3',
        durationMs: 1982730,
      },
      {
        title: 'The Dark Ages',
        page: '/classics/clcv-205/lecture-2',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall07/clcv205/mp3/clcv205_02_091107.mp3',
        durationMs: 4090990,
      },
      {
        title: 'The Dark Ages (cont.)',
        page: '/classics/clcv-205/lecture-3',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall07/clcv205/mp3/clcv205_03_091307.mp3',
        durationMs: 4349940,
      },
      {
        title: 'The Rise of the Polis',
        page: '/classics/clcv-205/lecture-4',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall07/clcv205/mp3/clcv205_04_091807.mp3',
        durationMs: 4080250,
      },
      {
        title: 'The Rise of the Polis (cont.)',
        page: '/classics/clcv-205/lecture-5',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall07/clcv205/mp3/clcv205_05_092007.mp3',
        durationMs: 4002640,
      },
      {
        title: 'The Greek “Renaissance” - Colonization and Tyranny',
        page: '/classics/clcv-205/lecture-6',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall07/clcv205/mp3/clcv205_06_092507.mp3',
        durationMs: 4111600,
      },
      {
        title: 'The Greek “Renaissance” - Colonization and Tyranny (cont.)',
        page: '/classics/clcv-205/lecture-7',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall07/clcv205/mp3/clcv205_07_092707.mp3',
        durationMs: 4171710,
      },
      {
        title: 'Sparta',
        page: '/classics/clcv-205/lecture-8',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall07/clcv205/mp3/clcv205_08_100207.mp3',
        durationMs: 4508240,
      },
      {
        title: 'Sparta (cont.)',
        page: '/classics/clcv-205/lecture-9',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall07/clcv205/mp3/clcv205_09_100407.mp3',
        durationMs: 4385910,
      },
      {
        title: 'The Rise of Athens',
        page: '/classics/clcv-205/lecture-10',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall07/clcv205/mp3/clcv205_10_100907.mp3',
        durationMs: 4299000,
      },
      {
        title: 'The Rise of Athens (cont.)',
        page: '/classics/clcv-205/lecture-11',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall07/clcv205/mp3/clcv205_11_101107.mp3',
        durationMs: 4380980,
      },
      {
        title: 'The Persian Wars',
        page: '/classics/clcv-205/lecture-12',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall07/clcv205/mp3/clcv205_12_101607.mp3',
        durationMs: 4741650,
      },
      {
        title: 'The Athenian Empire',
        page: '/classics/clcv-205/lecture-13',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall07/clcv205/mp3/clcv205_13_102307.mp3',
        durationMs: 4835190,
      },
      {
        title: 'The Athenian Empire (cont.)',
        page: '/classics/clcv-205/lecture-14',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall07/clcv205/mp3/clcv205_14_102507.mp3',
        durationMs: 4500300,
      },
      {
        title: 'Athenian Democracy',
        page: '/classics/clcv-205/lecture-15',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall07/clcv205/mp3/clcv205_15_103007.mp3',
        durationMs: 4173670,
      },
      {
        title: 'Athenian Democracy (cont.)',
        page: '/classics/clcv-205/lecture-16',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall07/clcv205/mp3/clcv205_16_110107.mp3',
        durationMs: 4396570,
      },
      {
        title: 'The Peloponnesian War, Part I',
        page: '/classics/clcv-205/lecture-17',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall07/clcv205/mp3/clcv205_17_110607.mp3',
        durationMs: 4457230,
      },
      {
        title: 'The Peloponnesian War, Part I (cont.)',
        page: '/classics/clcv-205/lecture-18',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall07/clcv205/mp3/clcv205_18_110807.mp3',
        durationMs: 4788200,
      },
      {
        title: 'The Peloponnesian War, Part II',
        page: '/classics/clcv-205/lecture-19',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall07/clcv205/mp3/clcv205_19_111307.mp3',
        durationMs: 4527420,
      },
      {
        title: 'The Peloponnesian War, Part II (cont.)',
        page: '/classics/clcv-205/lecture-20',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall07/clcv205/mp3/clcv205_20_111507.mp3',
        durationMs: 4225520,
      },
      {
        title: 'The Struggle for Hegemony in Fourth-Century Greece',
        page: '/classics/clcv-205/lecture-21',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall07/clcv205/mp3/clcv205_21_112707.mp3',
        durationMs: 4238480,
      },
      {
        title: 'The Struggle for Hegemony in Fourth-Century Greece (cont.)',
        page: '/classics/clcv-205/lecture-22',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall07/clcv205/mp3/clcv205_22_112907.mp3',
        durationMs: 4474360,
      },
      {
        title: 'Twilight of the Polis',
        page: '/classics/clcv-205/lecture-23',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall07/clcv205/mp3/clcv205_23_120407.mp3',
        durationMs: 4263500,
      },
      {
        title: 'Twilight of the Polis (cont.) and Conclusion',
        page: '/classics/clcv-205/lecture-24',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall07/clcv205/mp3/clcv205_24_120607.mp3',
        durationMs: 4575980,
      },
    ],
  },
  {
    id: 'eeb-122',
    code: 'EEB 122',
    title: 'Principles of Evolution, Ecology and Behavior',
    lecturer: 'Stephen C. Stearns',
    term: 'Spring 2009',
    department: 'Ecology and Evolutionary Biology',
    page: '/ecology-and-evolutionary-biology/eeb-122',
    description:
      'This course presents the principles of evolution, ecology, and behavior for students beginning their study of biology and of the environment. It discusses major ideas and results in a manner accessible to all Yale College undergraduates. Recent advances have energized these fields with results that have implications well beyond their boundaries: ideas, mechanisms, and processes that should form part of the toolkit of all biologists and educated citizens.',
    archive: 'oyc_Principles_of_Evolution__Ecology_and_Behavior',
    host: 'yale',
    lectures: [
      {
        title: 'The Nature of Evolution: Selection, Inheritance, and History',
        page: '/ecology-and-evolutionary-biology/eeb-122/lecture-1',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring09/eeb122/mp3/eeb122_01_011209.mp3',
        durationMs: 2585530,
      },
      {
        title: 'Basic Transmission Genetics',
        page: '/ecology-and-evolutionary-biology/eeb-122/lecture-2',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring09/eeb122/mp3/eeb122_02_011409.mp3',
        durationMs: 2675390,
      },
      {
        title: 'Adaptive Evolution: Natural Selection',
        page: '/ecology-and-evolutionary-biology/eeb-122/lecture-3',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring09/eeb122/mp3/eeb122_03_011609.mp3',
        durationMs: 2753000,
      },
      {
        title: 'Neutral Evolution: Genetic Drift',
        page: '/ecology-and-evolutionary-biology/eeb-122/lecture-4',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring09/eeb122/mp3/eeb122_04_012109.mp3',
        durationMs: 2642340,
      },
      {
        title: 'How Selection Changes the Genetic Composition of Population',
        page: '/ecology-and-evolutionary-biology/eeb-122/lecture-5',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring09/eeb122/mp3/eeb122_05_012309.mp3',
        durationMs: 2970420,
      },
      {
        title: 'The Origin and Maintenance of Genetic Variation',
        page: '/ecology-and-evolutionary-biology/eeb-122/lecture-6',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring09/eeb122/mp3/eeb122_06_012609.mp3',
        durationMs: 2894970,
      },
      {
        title: 'The Importance of Development in Evolution',
        page: '/ecology-and-evolutionary-biology/eeb-122/lecture-7',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring09/eeb122/mp3/eeb122_07_012809.mp3',
        durationMs: 2750310,
      },
      {
        title: 'The Expression of Variation: Reaction Norms',
        page: '/ecology-and-evolutionary-biology/eeb-122/lecture-8',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring09/eeb122/mp3/eeb122_08_013009.mp3',
        durationMs: 2599110,
      },
      {
        title: 'The Evolution of Sex',
        page: '/ecology-and-evolutionary-biology/eeb-122/lecture-9',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring09/eeb122/mp3/eeb122_09_020209.mp3',
        durationMs: 2947110,
      },
      {
        title: 'Genomic Conflict',
        page: '/ecology-and-evolutionary-biology/eeb-122/lecture-10',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring09/eeb122/mp3/eeb122_10_020409.mp3',
        durationMs: 2871100,
      },
      {
        title: 'Life History Evolution',
        page: '/ecology-and-evolutionary-biology/eeb-122/lecture-11',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring09/eeb122/mp3/eeb122_11_020609.mp3',
        durationMs: 2737770,
      },
      {
        title: 'Sex Allocation',
        page: '/ecology-and-evolutionary-biology/eeb-122/lecture-12',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring09/eeb122/mp3/eeb122_12_020909.mp3',
        durationMs: 2906130,
      },
      {
        title: 'Sexual Selection',
        page: '/ecology-and-evolutionary-biology/eeb-122/lecture-13',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring09/eeb122/mp3/eeb122_13_021109.mp3',
        durationMs: 2766240,
      },
      {
        title: 'Species and Speciation',
        page: '/ecology-and-evolutionary-biology/eeb-122/lecture-14',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring09/eeb122/mp3/eeb122_14_021309.mp3',
        durationMs: 3032040,
      },
      {
        title: 'Phylogeny and Systematics',
        page: '/ecology-and-evolutionary-biology/eeb-122/lecture-15',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring09/eeb122/mp3/eeb122_15_021609.mp3',
        durationMs: 2614810,
      },
      {
        title: 'Comparative Methods: Trees, Maps, and Traits',
        page: '/ecology-and-evolutionary-biology/eeb-122/lecture-16',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring09/eeb122/mp3/eeb122_16_021809.mp3',
        durationMs: 2999570,
      },
      {
        title: 'Key Events in Evolution',
        page: '/ecology-and-evolutionary-biology/eeb-122/lecture-17',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring09/eeb122/mp3/eeb122_17_022009.mp3',
        durationMs: 2906600,
      },
      {
        title: 'Major Events in the Geological Theatre',
        page: '/ecology-and-evolutionary-biology/eeb-122/lecture-18',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring09/eeb122/mp3/eeb122_18_022309.mp3',
        durationMs: 2830190,
      },
      {
        title: 'The Fossil Record and Life’s History',
        page: '/ecology-and-evolutionary-biology/eeb-122/lecture-19',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring09/eeb122/mp3/eeb122_19_022509.mp3',
        durationMs: 2874570,
      },
      {
        title: 'Coevolution',
        page: '/ecology-and-evolutionary-biology/eeb-122/lecture-20',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring09/eeb122/mp3/eeb122_20_022709.mp3',
        durationMs: 2895370,
      },
      {
        title: 'Evolutionary Medicine',
        page: '/ecology-and-evolutionary-biology/eeb-122/lecture-21',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring09/eeb122/mp3/eeb122_21_030209.mp3',
        durationMs: 2877940,
      },
      {
        title: 'The Impact of Evolutionary Thought on the Social Sciences',
        page: '/ecology-and-evolutionary-biology/eeb-122/lecture-22',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring09/eeb122/mp3/eeb122_22_030609.mp3',
        durationMs: 2845550,
      },
      {
        title: 'The Logic of Science',
        page: '/ecology-and-evolutionary-biology/eeb-122/lecture-23',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring09/eeb122/mp3/eeb122_23_032309.mp3',
        durationMs: 2734580,
      },
      {
        title: 'Climate and the Distribution of Life on Earth',
        page: '/ecology-and-evolutionary-biology/eeb-122/lecture-24',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring09/eeb122/mp3/eeb122_24_032509.mp3',
        durationMs: 2564210,
      },
      {
        title: 'Interactions with the Physical Environment',
        page: '/ecology-and-evolutionary-biology/eeb-122/lecture-25',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring09/eeb122/mp3/eeb122_25_032709.mp3',
        durationMs: 2937580,
      },
      {
        title: 'Population Growth: Density Effects',
        page: '/ecology-and-evolutionary-biology/eeb-122/lecture-26',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring09/eeb122/mp3/eeb122_26_033009.mp3',
        durationMs: 2568550,
      },
      {
        title: 'Interspecific Competition',
        page: '/ecology-and-evolutionary-biology/eeb-122/lecture-27',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring09/eeb122/mp3/eeb122_27_040109.mp3',
        durationMs: 2393550,
      },
      {
        title: 'Ecological Communities',
        page: '/ecology-and-evolutionary-biology/eeb-122/lecture-28',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring09/eeb122/mp3/eeb122_28_040609.mp3',
        durationMs: 2741580,
      },
      {
        title: 'Island Biogeography and Invasive Species',
        page: '/ecology-and-evolutionary-biology/eeb-122/lecture-29',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring09/eeb122/mp3/eeb122_29_040809.mp3',
        durationMs: 2461990,
      },
      {
        title: 'Energy and Matter in Ecosystems',
        page: '/ecology-and-evolutionary-biology/eeb-122/lecture-30',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring09/eeb122/mp3/eeb122_30_041009.mp3',
        durationMs: 2977680,
      },
      {
        title: 'Why So Many Species? The Factors Affecting Biodiversity',
        page: '/ecology-and-evolutionary-biology/eeb-122/lecture-31',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring09/eeb122/mp3/eeb122_31_041309.mp3',
        durationMs: 2907620,
      },
      {
        title: 'Economic Decisions for the Foraging Individual',
        page: '/ecology-and-evolutionary-biology/eeb-122/lecture-32',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring09/eeb122/mp3/eeb122_32_041509.mp3',
        durationMs: 2977890,
      },
      {
        title: 'Evolutionary Game Theory: Fighting and Contests',
        page: '/ecology-and-evolutionary-biology/eeb-122/lecture-33',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring09/eeb122/mp3/eeb122_33_041709.mp3',
        durationMs: 2719120,
      },
      {
        title: 'Mating Systems and Parental Care',
        page: '/ecology-and-evolutionary-biology/eeb-122/lecture-34',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring09/eeb122/mp3/eeb122_34_042009.mp3',
        durationMs: 2454970,
      },
      {
        title: 'Alternative Breeding Strategies',
        page: '/ecology-and-evolutionary-biology/eeb-122/lecture-35',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring09/eeb122/mp3/eeb122_35_042209.mp3',
        durationMs: 2631530,
      },
      {
        title: 'Selfishness and Altruism',
        page: '/ecology-and-evolutionary-biology/eeb-122/lecture-36',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring09/eeb122/mp3/eeb122_36_042409.mp3',
        durationMs: 1866010,
      },
    ],
  },
  {
    id: 'econ-252-2008',
    code: 'ECON 252',
    title: 'Financial Markets (2008)',
    lecturer: 'Robert J. Shiller',
    term: 'Spring 2008',
    department: 'Economics',
    page: '/economics/econ-252-08',
    description:
      'Financial institutions are a pillar of civilized society, supporting people in their productive ventures and managing the economic risks they take on. The workings of these institutions are important to comprehend if we are to predict their actions today and their evolution in the coming information age. The course strives to offer understanding of the theory of finance and its relation to the history, strengths and imperfections of such institutions as banking, insurance, securities, futures, and other derivatives markets, and the future of these institutions over the next century.',
    archive: 'oyc_Financial_Markets_2008',
    host: 'yale',
    lectures: [
      {
        title: 'Finance and Insurance as Powerful Forces in Our Economy and Society',
        page: '/economics/econ-252-08/lecture-1',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring08/econ252/mp3/econ252_01_011408.mp3',
        durationMs: 4443960,
      },
      {
        title: 'The Universal Principle of Risk Management: Pooling and the Hedging of Risks',
        page: '/economics/econ-252-08/lecture-2',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring08/econ252/mp3/econ252_02_011608.mp3',
        durationMs: 4147570,
      },
      {
        title: 'Technology and Invention in Finance',
        page: '/economics/econ-252-08/lecture-3',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring08/econ252/mp3/econ252_03_011808.mp3',
        durationMs: 4495710,
      },
      {
        title: 'Portfolio Diversification and Supporting Financial Institutions (CAPM Model)',
        page: '/economics/econ-252-08/lecture-4',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring08/econ252/mp3/econ252_04_012808.mp3',
        durationMs: 4035040,
      },
      {
        title: 'Insurance: The Archetypal Risk Management Institution',
        page: '/economics/econ-252-08/lecture-5',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring08/econ252/mp3/econ252_05_013008.mp3',
        durationMs: 4511350,
      },
      {
        title: 'Efficient Markets vs. Excess Volatility',
        page: '/economics/econ-252-08/lecture-6',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring08/econ252/mp3/econ252_06_020108.mp3',
        durationMs: 4097490,
      },
      {
        title: 'Behavioral Finance: The Role of Psychology',
        page: '/economics/econ-252-08/lecture-7',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring08/econ252/mp3/econ252_07_020408.mp3',
        durationMs: 3909310,
      },
      {
        title: 'Human Foibles, Fraud, Manipulation, and Regulation',
        page: '/economics/econ-252-08/lecture-8',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring08/econ252/mp3/econ252_08_020608.mp3',
        durationMs: 4314340,
      },
      {
        title: 'Guest Lecture by David Swensen',
        page: '/economics/econ-252-08/lecture-9',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring08/econ252/mp3/econ252_09_021308.mp3',
        durationMs: 4283750,
      },
      {
        title: 'Debt Markets: Term Structure',
        page: '/economics/econ-252-08/lecture-10',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring08/econ252/mp3/econ252_10_021508.mp3',
        durationMs: 4244720,
      },
      {
        title: 'Stocks',
        page: '/economics/econ-252-08/lecture-11',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring08/econ252/mp3/econ252_11_022008.mp3',
        durationMs: 4454590,
      },
      {
        title: 'Real Estate Finance and Its Vulnerability to Crisis',
        page: '/economics/econ-252-08/lecture-12',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring08/econ252/mp3/econ252_12_022508.mp3',
        durationMs: 4048910,
      },
      {
        title: 'Banking: Successes and Failures',
        page: '/economics/econ-252-08/lecture-13',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring08/econ252/mp3/econ252_13_030308.mp3',
        durationMs: 4295290,
      },
      {
        title: 'Guest Lecture by Andrew Redleaf',
        page: '/economics/econ-252-08/lecture-14',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring08/econ252/mp3/econ252_14_030508.mp3',
        durationMs: 4528120,
      },
      {
        title: 'Guest Lecture by Carl Icahn',
        page: '/economics/econ-252-08/lecture-15',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring08/econ252/mp3/econ252_15_032408.mp3',
        durationMs: 2542950,
      },
      {
        title: 'The Evolution and Perfection of Monetary Policy',
        page: '/economics/econ-252-08/lecture-16',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring08/econ252/mp3/econ252_16_032608.mp3',
        durationMs: 4216640,
      },
      {
        title: 'Investment Banking and Secondary Markets',
        page: '/economics/econ-252-08/lecture-17',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring08/econ252/mp3/econ252_17_040208.mp3',
        durationMs: 4338340,
      },
      {
        title: 'Professional Money Managers and Their Influence',
        page: '/economics/econ-252-08/lecture-18',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring08/econ252/mp3/econ252_18_040708.mp3',
        durationMs: 4361230,
      },
      {
        title: 'Brokerage, ECNs, etc.',
        page: '/economics/econ-252-08/lecture-19',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring08/econ252/mp3/econ252_19_040908.mp3',
        durationMs: 4358410,
      },
      {
        title: 'Guest Lecture by Stephen Schwarzman',
        page: '/economics/econ-252-08/lecture-20',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring08/econ252/mp3/econ252_20_041108.mp3',
        durationMs: 4147620,
      },
      {
        title: 'Forwards and Futures',
        page: '/economics/econ-252-08/lecture-21',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring08/econ252/mp3/econ252_21_041408.mp3',
        durationMs: 4329830,
      },
      {
        title: 'Stock Index, Oil and Other Futures Markets',
        page: '/economics/econ-252-08/lecture-22',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring08/econ252/mp3/econ252_22_041608.mp3',
        durationMs: 4234920,
      },
      {
        title: 'Options Markets',
        page: '/economics/econ-252-08/lecture-23',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring08/econ252/mp3/econ252_23_042108.mp3',
        durationMs: 4071110,
      },
      {
        title: 'Making It Work for Real People: The Democratization of Finance',
        page: '/economics/econ-252-08/lecture-24',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring08/econ252/mp3/econ252_24_042308.mp3',
        durationMs: 4039820,
      },
      {
        title:
          'Okun Lecture: Learning from and Responding to Financial Crisis, Part I (Guest Lecture by Lawrence Summers)',
        page: '/economics/econ-252-08/lecture-25',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring08/econ252/mp3/econ252_25_042908.mp3',
        durationMs: 5449780,
      },
      {
        title:
          'Okun Lecture: Learning from and Responding to Financial Crisis, Part II (Guest Lecture by Lawrence Summers)',
        page: '/economics/econ-252-08/lecture-26',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring08/econ252/mp3/econ252_26_043008.mp3',
        durationMs: 5901220,
      },
    ],
  },
  {
    id: 'econ-252-2011',
    code: 'ECON 252',
    title: 'Financial Markets (2011)',
    lecturer: 'Robert J. Shiller',
    term: 'Spring 2011',
    department: 'Economics',
    page: '/economics/econ-252',
    description:
      'An overview of the ideas, methods, and institutions that permit human society to manage risks and foster enterprise. Description of practices today and analysis of prospects for the future. Introduction to risk management and behavioral finance principles to understand the functioning of securities, insurance, and banking industries.',
    archive: 'oyc_Financial_Markets_2011',
    host: 'yale',
    lectures: [
      {
        title: 'Introduction and What this Course Will Do for You and Your Purposes',
        page: '/economics/econ-252-11/lecture-1',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring11/econ252/mp3/econ252_01_011011.mp3',
        durationMs: 4451820,
      },
      {
        title: 'Risk and Financial Crises',
        page: '/economics/econ-252-11/lecture-2',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring11/econ252/mp3/econ252_02_011411.mp3',
        durationMs: 4184060,
      },
      {
        title: 'Technology and Invention in Finance',
        page: '/economics/econ-252-11/lecture-3',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring11/econ252/mp3/econ252_03_011911.mp3',
        durationMs: 4528540,
      },
      {
        title: 'Portfolio Diversification and Supporting Financial Institutions',
        page: '/economics/econ-252-11/lecture-4',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring11/econ252/mp3/econ252_04_012411.mp3',
        durationMs: 4680910,
      },
      {
        title:
          'Insurance, the Archetypal Risk Management Institution: Its Opportunities and Vulnerabilities',
        page: '/economics/econ-252-11/lecture-5',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring11/econ252/mp3/econ252_05_013111.mp3',
        durationMs: 4395420,
      },
      {
        title: 'Guest Speaker: David Swensen',
        page: '/economics/econ-252-11/lecture-6',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring11/econ252/mp3/econ252_06_020211.mp3',
        durationMs: 4311990,
      },
      {
        title: 'Efficient Markets',
        page: '/economics/econ-252-11/lecture-7',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring11/econ252/mp3/econ252_07_020711.mp3',
        durationMs: 4064160,
      },
      {
        title: 'Theory of Debt, Its Proper Role, Leverage Cycles',
        page: '/economics/econ-252-11/lecture-8',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring11/econ252/mp3/econ252_08_021111.mp3',
        durationMs: 4516520,
      },
      {
        title: 'Corporate Stocks',
        page: '/economics/econ-252-11/lecture-9',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring11/econ252/mp3/econ252_09_021411.mp3',
        durationMs: 4599930,
      },
      {
        title: 'Real Estate',
        page: '/economics/econ-252-11/lecture-10',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring11/econ252/mp3/econ252_10_021611.mp3',
        durationMs: 4124030,
      },
      {
        title: 'Behavioral Finance and the Role of Psychology',
        page: '/economics/econ-252-11/lecture-11',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring11/econ252/mp3/econ252_11_022111.mp3',
        durationMs: 4683110,
      },
      {
        title: 'Misbehavior, Crises, Regulation and Self Regulation',
        page: '/economics/econ-252-11/lecture-12',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring11/econ252/mp3/econ252_12_022311.mp3',
        durationMs: 4588130,
      },
      {
        title: 'Banks',
        page: '/economics/econ-252-11/lecture-13',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring11/econ252/mp3/econ252_13_022811.mp3',
        durationMs: 4402450,
      },
      {
        title: 'Guest Speaker Maurice “Hank” Greenberg',
        page: '/economics/econ-252-11/lecture-14',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring11/econ252/mp3/econ252_14_030211.mp3',
        durationMs: 4248400,
      },
      {
        title: 'Forward and Futures Markets',
        page: '/economics/econ-252-11/lecture-15',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring11/econ252/mp3/econ252_15_032111.mp3',
        durationMs: 4356450,
      },
      {
        title: 'Guest Speaker Laura Cha',
        page: '/economics/econ-252-11/lecture-16',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring11/econ252/mp3/econ252_16_032811.mp3',
        durationMs: 3770680,
      },
      {
        title: 'Options Markets',
        page: '/economics/econ-252-11/lecture-17',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring11/econ252/mp3/econ252_17_033011.mp3',
        durationMs: 4316370,
      },
      {
        title: 'Monetary Policy',
        page: '/economics/econ-252-11/lecture-18',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring11/econ252/mp3/econ252_18_040411.mp3',
        durationMs: 4291770,
      },
      {
        title: 'Investment Banks',
        page: '/economics/econ-252-11/lecture-19',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring11/econ252/mp3/econ252_19_040611.mp3',
        durationMs: 4278210,
      },
      {
        title: 'Professional Money Managers and Their Influence',
        page: '/economics/econ-252-11/lecture-20',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring11/econ252/mp3/econ252_20_041111.mp3',
        durationMs: 4404430,
      },
      {
        title: 'Exchanges, Brokers, Dealers, Clearinghouses',
        page: '/economics/econ-252-11/lecture-21',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring11/econ252/mp3/econ252_21_041311.mp3',
        durationMs: 4162120,
      },
      {
        title: 'Public and Non-Profit Finance',
        page: '/economics/econ-252-11/lecture-22',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring11/econ252/mp3/econ252_22_041811.mp3',
        durationMs: 4353180,
      },
      {
        title: 'Finding Your Purpose in a World of Financial Capitalism',
        page: '/economics/econ-252-11/lecture-23',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring11/econ252/mp3/econ252_23_042011.mp3',
        durationMs: 4551610,
      },
    ],
  },
  {
    id: 'econ-251',
    code: 'ECON 251',
    title: 'Financial Theory',
    lecturer: 'John Geanakoplos',
    term: 'Fall 2009',
    department: 'Economics',
    page: '/economics/econ-251',
    description:
      'This course attempts to explain the role and the importance of the financial system in the global economy. Rather than separating off the financial world from the rest of the economy, financial equilibrium is studied as an extension of economic equilibrium. The course also gives a picture of the kind of thinking and analysis done by hedge funds.',
    archive: 'oyc_Financial_Theory',
    host: 'yale',
    lectures: [
      {
        title: 'Why Finance?',
        page: '/economics/econ-251/lecture-1',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall09/econ251/mp3/econ251_01_090309.mp3',
        durationMs: 4456470,
      },
      {
        title: 'Utilities, Endowments, and Equilibrium',
        page: '/economics/econ-251/lecture-2',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall09/econ251/mp3/econ251_02_090809.mp3',
        durationMs: 4336750,
      },
      {
        title: 'Computing Equilibrium',
        page: '/economics/econ-251/lecture-3',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall09/econ251/mp3/econ251_03_091009.mp3',
        durationMs: 4471150,
      },
      {
        title: 'Efficiency, Assets, and Time',
        page: '/economics/econ-251/lecture-4',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall09/econ251/mp3/econ251_04_091509.mp3',
        durationMs: 4288400,
      },
      {
        title: 'Present Value Prices and the Real Rate of Interest',
        page: '/economics/econ-251/lecture-5',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall09/econ251/mp3/econ251_05_091709.mp3',
        durationMs: 4453780,
      },
      {
        title: 'Irving Fisher’s Impatience Theory of Interest',
        page: '/economics/econ-251/lecture-6',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall09/econ251/mp3/econ251_06_092209.mp3',
        durationMs: 4256190,
      },
      {
        title:
          'Shakespeare’s Merchant of Venice and Collateral, Present Value and the Vocabulary of Finance',
        page: '/economics/econ-251/lecture-7',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall09/econ251/mp3/econ251_07_092409.mp3',
        durationMs: 4714220,
      },
      {
        title: 'How a Long-Lived Institution Figures an Annual Budget; Yield',
        page: '/economics/econ-251/lecture-8',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall09/econ251/mp3/econ251_08_092909.mp3',
        durationMs: 4571880,
      },
      {
        title: 'Yield Curve Arbitrage',
        page: '/economics/econ-251/lecture-9',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall09/econ251/mp3/econ251_09_100109.mp3',
        durationMs: 4507200,
      },
      {
        title: 'Dynamic Present Value',
        page: '/economics/econ-251/lecture-10',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall09/econ251/mp3/econ251_10_100609.mp3',
        durationMs: 4177460,
      },
      {
        title: 'Social Security',
        page: '/economics/econ-251/lecture-11',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall09/econ251/mp3/econ251_11_100809.mp3',
        durationMs: 4340490,
      },
      {
        title: 'Overlapping Generations Models of the Economy',
        page: '/economics/econ-251/lecture-12',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall09/econ251/mp3/econ251_12_101309.mp3',
        durationMs: 4353550,
      },
      {
        title:
          'Demography and Asset Pricing: Will the Stock Market Decline when the Baby Boomers Retire?',
        page: '/economics/econ-251/lecture-13',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall09/econ251/mp3/econ251_13_101509.mp3',
        durationMs: 4341870,
      },
      {
        title: 'Quantifying Uncertainty and Risk',
        page: '/economics/econ-251/lecture-14',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall09/econ251/mp3/econ251_14_102209.mp3',
        durationMs: 3849250,
      },
      {
        title:
          'Uncertainty and the Rational Expectations Hypothesis: Applications to Predicting Stock Prices, Default Probabilities, and Hyperbolic Discounting',
        page: '/economics/econ-251/lecture-15',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall09/econ251/mp3/econ251_15_102709.mp3',
        durationMs: 4569210,
      },
      {
        title: 'Backward Induction and Optimal Stopping Times',
        page: '/economics/econ-251/lecture-16',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall09/econ251/mp3/econ251_16_102909.mp3',
        durationMs: 4754080,
      },
      {
        title: 'Callable Bonds and the Mortgage Prepayment Option',
        page: '/economics/econ-251/lecture-17',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall09/econ251/mp3/econ251_17_110309.mp3',
        durationMs: 4333330,
      },
      {
        title: 'Modeling Mortgage Prepayments and Valuing Mortgages',
        page: '/economics/econ-251/lecture-18',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall09/econ251/mp3/econ251_18_110509.mp3',
        durationMs: 4325260,
      },
      {
        title: 'History of the Mortgage Market: A Personal Narrative',
        page: '/economics/econ-251/lecture-19',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall09/econ251/mp3/econ251_19_120810.mp3',
        durationMs: 4757560,
      },
      {
        title: 'Dynamic Hedging',
        page: '/economics/econ-251/lecture-20',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall09/econ251/mp3/econ251_20_111009.mp3',
        durationMs: 4349790,
      },
      {
        title: 'Dynamic Hedging and Average Life',
        page: '/economics/econ-251/lecture-21',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall09/econ251/mp3/econ251_21_111209.mp3',
        durationMs: 4421490,
      },
      {
        title: 'Risk Aversion and the Capital Asset Pricing Theorem',
        page: '/economics/econ-251/lecture-22',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall09/econ251/mp3/econ251_22_111709.mp3',
        durationMs: 4566500,
      },
      {
        title: 'The Mutual Fund Theorem and Covariance Pricing Theorems',
        page: '/economics/econ-251/lecture-23',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall09/econ251/mp3/econ251_23_111909.mp3',
        durationMs: 4564720,
      },
      {
        title: 'Risk, Return, and Social Security',
        page: '/economics/econ-251/lecture-24',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall09/econ251/mp3/econ251_24_120109.mp3',
        durationMs: 4449940,
      },
      {
        title: 'The Leverage Cycle and the Subprime Mortgage Crisis',
        page: '/economics/econ-251/lecture-25',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall09/econ251/mp3/econ251_25_120809.mp3',
        durationMs: 4590160,
      },
      {
        title: 'The Leverage Cycle and Crashes',
        page: '/economics/econ-251/lecture-26',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall09/econ251/mp3/econ251_26_121009.mp3',
        durationMs: 4211410,
      },
    ],
  },
  {
    id: 'econ-159',
    code: 'ECON 159',
    title: 'Game Theory',
    lecturer: 'Ben Polak',
    term: 'Fall 2007',
    department: 'Economics',
    page: '/economics/econ-159',
    description:
      'This course is an introduction to game theory and strategic thinking. Ideas such as dominance, backward induction, Nash equilibrium, evolutionary stability, commitment, credibility, asymmetric information, adverse selection, and signaling are discussed and applied to games played in class and to examples drawn from economics, politics, the movies, and elsewhere.',
    archive: 'oyc_Game_Theory',
    host: 'yale',
    lectures: [
      {
        title: 'Introduction: Five First Lessons',
        page: '/economics/econ-159/lecture-1',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall07/econ159/mp3/econ159_01_090507.mp3',
        durationMs: 4112850,
      },
      {
        title: 'Putting Yourselves into Other People’s Shoes',
        page: '/economics/econ-159/lecture-2',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall07/econ159/mp3/econ159_02_091007.mp3',
        durationMs: 4128740,
      },
      {
        title: 'Iterative Deletion and the Median-Voter Theorem',
        page: '/economics/econ-159/lecture-3',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall07/econ159/mp3/econ159_03_091207.mp3',
        durationMs: 3679540,
      },
      {
        title: 'Best Responses in Soccer and Business Partnerships',
        page: '/economics/econ-159/lecture-4',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall07/econ159/mp3/econ159_04_091707.mp3',
        durationMs: 4325100,
      },
      {
        title: 'Nash Equilibrium: Bad Fashion and Bank Runs',
        page: '/economics/econ-159/lecture-5',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall07/econ159/mp3/econ159_05_091907.mp3',
        durationMs: 4154050,
      },
      {
        title: 'Nash Equilibrium: Dating and Cournot',
        page: '/economics/econ-159/lecture-6',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall07/econ159/mp3/econ159_06_092407.mp3',
        durationMs: 4326170,
      },
      {
        title: 'Nash Equilibrium: Shopping, Standing and Voting on a Line',
        page: '/economics/econ-159/lecture-7',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall07/econ159/mp3/econ159_07_092607.mp3',
        durationMs: 4281160,
      },
      {
        title: 'Nash Equilibrium: Location, Segregation and Randomization',
        page: '/economics/econ-159/lecture-8',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall07/econ159/mp3/econ159_08_100107.mp3',
        durationMs: 4430010,
      },
      {
        title: 'Mixed Strategies in Theory and Tennis',
        page: '/economics/econ-159/lecture-9',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall07/econ159/mp3/econ159_09_100307.mp3',
        durationMs: 4372930,
      },
      {
        title: 'Mixed Strategies in Baseball, Dating and Paying Your Taxes',
        page: '/economics/econ-159/lecture-10',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall07/econ159/mp3/econ159_10_100807.mp3',
        durationMs: 4412090,
      },
      {
        title: 'Evolutionary Stability: Cooperation, Mutation, and Equilibrium',
        page: '/economics/econ-159/lecture-11',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall07/econ159/mp3/econ159_11_101007.mp3',
        durationMs: 4326200,
      },
      {
        title: 'Evolutionary Stability: Social Convention, Aggression, and Cycles',
        page: '/economics/econ-159/lecture-12',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall07/econ159/mp3/econ159_12_101507.mp3',
        durationMs: 3965890,
      },
      {
        title: 'Sequential Games: Moral Hazard, Incentives, and Hungry Lions',
        page: '/economics/econ-159/lecture-13',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall07/econ159/mp3/econ159_13_102207.mp3',
        durationMs: 4232440,
      },
      {
        title: 'Backward Induction: Commitment, Spies, and First-Mover Advantages',
        page: '/economics/econ-159/lecture-14',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall07/econ159/mp3/econ159_14_102407.mp3',
        durationMs: 4026280,
      },
      {
        title: 'Backward Induction: Chess, Strategies, and Credible Threats',
        page: '/economics/econ-159/lecture-15',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall07/econ159/mp3/econ159_15_102907.mp3',
        durationMs: 4359010,
      },
      {
        title: 'Backward Induction: Reputation and Duels',
        page: '/economics/econ-159/lecture-16',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall07/econ159/mp3/econ159_16_103107.mp3',
        durationMs: 4540740,
      },
      {
        title: 'Backward Induction: Ultimatums and Bargaining',
        page: '/economics/econ-159/lecture-17',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall07/econ159/mp3/econ159_17_110507.mp3',
        durationMs: 4244220,
      },
      {
        title: 'Imperfect Information: Information Sets and Sub-Game Perfection',
        page: '/economics/econ-159/lecture-18',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall07/econ159/mp3/econ159_18_110707.mp3',
        durationMs: 4557590,
      },
      {
        title: 'Subgame Perfect Equilibrium: Matchmaking and Strategic Investments',
        page: '/economics/econ-159/lecture-19',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall07/econ159/mp3/econ159_19_111207.mp3',
        durationMs: 4628850,
      },
      {
        title: 'Subgame Perfect Equilibrium: Wars of Attrition',
        page: '/economics/econ-159/lecture-20',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall07/econ159/mp3/econ159_20_111407.mp3',
        durationMs: 4536270,
      },
      {
        title: 'Repeated Games: Cooperation vs. the End Game',
        page: '/economics/econ-159/lecture-21',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall07/econ159/mp3/econ159_21_112607.mp3',
        durationMs: 4519080,
      },
      {
        title: 'Repeated Games: Cheating, Punishment, and Outsourcing',
        page: '/economics/econ-159/lecture-22',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall07/econ159/mp3/econ159_22_112807.mp3',
        durationMs: 4546670,
      },
      {
        title: 'Asymmetric Information: Silence, Signaling and Suffering Education',
        page: '/economics/econ-159/lecture-23',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall07/econ159/mp3/econ159_23_120307.mp3',
        durationMs: 4236570,
      },
      {
        title: 'Asymmetric Information: Auctions and the Winner’s Curse',
        page: '/economics/econ-159/lecture-24',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall07/econ159/mp3/econ159_24_120507.mp3',
        durationMs: 3748240,
      },
    ],
  },
  {
    id: 'engl-300',
    code: 'ENGL 300',
    title: 'Introduction to Theory of Literature',
    lecturer: 'Paul H. Fry',
    term: 'Spring 2009',
    department: 'English',
    page: '/english/engl-300',
    description:
      'This is a survey of the main trends in twentieth-century literary theory. Lectures will provide background for the readings and explicate them where appropriate, while attempting to develop a coherent overall context that incorporates philosophical and social perspectives on the recurrent questions: what is literature, how is it produced, how can it be understood, and what is its purpose?',
    archive: 'oyc_Introduction_to_Theory_of_Literature',
    host: 'yale',
    lectures: [
      {
        title: 'Introduction',
        page: '/english/engl-300/lecture-1',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring09/engl300/mp3/engl300_01_011309.mp3',
        durationMs: 2368840,
      },
      {
        title: 'Introduction (cont.)',
        page: '/english/engl-300/lecture-2',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring09/engl300/mp3/engl300_02_011509.mp3',
        durationMs: 2790330,
      },
      {
        title: 'Ways In and Out of the Hermeneutic Circle',
        page: '/english/engl-300/lecture-3',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring09/engl300/mp3/engl300_03_012209.mp3',
        durationMs: 2803810,
      },
      {
        title: 'Configurative Reading',
        page: '/english/engl-300/lecture-4',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring09/engl300/mp3/engl300_04_013009.mp3',
        durationMs: 3133730,
      },
      {
        title: 'The Idea of the Autonomous Artwork',
        page: '/english/engl-300/lecture-5',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring09/engl300/mp3/engl300_05_012709.mp3',
        durationMs: 2784840,
      },
      {
        title: 'The New Criticism and Other Western Formalisms',
        page: '/english/engl-300/lecture-6',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring09/engl300/mp3/engl300_06_012909.mp3',
        durationMs: 3007070,
      },
      {
        title: 'Russian Formalism',
        page: '/english/engl-300/lecture-7',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring09/engl300/mp3/engl300_07_020309.mp3',
        durationMs: 2936720,
      },
      {
        title: 'Semiotics and Structuralism',
        page: '/english/engl-300/lecture-8',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring09/engl300/mp3/engl300_08_020509.mp3',
        durationMs: 3090630,
      },
      {
        title: 'Linguistics and Literature',
        page: '/english/engl-300/lecture-9',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring09/engl300/mp3/engl300_09_021009.mp3',
        durationMs: 2994030,
      },
      {
        title: 'Deconstruction I',
        page: '/english/engl-300/lecture-10',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring09/engl300/mp3/engl300_10_021209.mp3',
        durationMs: 3102910,
      },
      {
        title: 'Deconstruction II',
        page: '/english/engl-300/lecture-11',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring09/engl300/mp3/engl300_11_021709.mp3',
        durationMs: 3177720,
      },
      {
        title: 'Freud and Fiction',
        page: '/english/engl-300/lecture-12',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring09/engl300/mp3/engl300_12_021909.mp3',
        durationMs: 3039720,
      },
      {
        title: 'Jacques Lacan in Theory',
        page: '/english/engl-300/lecture-13',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring09/engl300/mp3/engl300_13_022409.mp3',
        durationMs: 3069240,
      },
      {
        title: 'Influence',
        page: '/english/engl-300/lecture-14',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring09/engl300/mp3/engl300_14_022609.mp3',
        durationMs: 3076420,
      },
      {
        title: 'The Postmodern Psyche',
        page: '/english/engl-300/lecture-15',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring09/engl300/mp3/engl300_15_030309.mp3',
        durationMs: 3169940,
      },
      {
        title: 'The Social Permeability of Reader and Text',
        page: '/english/engl-300/lecture-16',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring09/engl300/mp3/engl300_16_030509.mp3',
        durationMs: 3009390,
      },
      {
        title: 'The Frankfurt School of Critical Theory',
        page: '/english/engl-300/lecture-17',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring09/engl300/mp3/engl300_17_032409.mp3',
        durationMs: 3096510,
      },
      {
        title: 'The Political Unconscious',
        page: '/english/engl-300/lecture-18',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring09/engl300/mp3/engl300_18_032609.mp3',
        durationMs: 3225400,
      },
      {
        title: 'The New Historicism',
        page: '/english/engl-300/lecture-19',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring09/engl300/mp3/engl300_19_033109.mp3',
        durationMs: 3201730,
      },
      {
        title: 'The Classical Feminist Tradition',
        page: '/english/engl-300/lecture-20',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring09/engl300/mp3/engl300_20_040209.mp3',
        durationMs: 3144100,
      },
      {
        title: 'African-American Criticism',
        page: '/english/engl-300/lecture-21',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring09/engl300/mp3/engl300_21_040709.mp3',
        durationMs: 3237730,
      },
      {
        title: 'Post-Colonial Criticism',
        page: '/english/engl-300/lecture-22',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring09/engl300/mp3/engl300_22_040909.mp3',
        durationMs: 3281740,
      },
      {
        title: 'Queer Theory and Gender Performativity',
        page: '/english/engl-300/lecture-23',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring09/engl300/mp3/engl300_23_041409.mp3',
        durationMs: 2994600,
      },
      {
        title: 'The Institutional Construction of Literary Study',
        page: '/english/engl-300/lecture-24',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring09/engl300/mp3/engl300_24_041609.mp3',
        durationMs: 3052620,
      },
      {
        title: 'The End of Theory?; Neo-Pragmatism',
        page: '/english/engl-300/lecture-25',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring09/engl300/mp3/engl300_25_042109.mp3',
        durationMs: 3212650,
      },
      {
        title: 'Reflections; Who Doesn’t Hate Theory Now?',
        page: '/english/engl-300/lecture-26',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring09/engl300/mp3/engl300_26_042309.mp3',
        durationMs: 2987530,
      },
    ],
  },
  {
    id: 'engl-220',
    code: 'ENGL 220',
    title: 'Milton',
    lecturer: 'John Rogers',
    term: 'Fall 2007',
    department: 'English',
    page: '/english/engl-220',
    description:
      'This class is a study of Milton’s poetry, with attention paid to his literary sources, his contemporaries, his controversial prose, and his decisive influence on the course of English poetry. Throughout the course, Professor Rogers explores the advantages and limitations of a diverse range of interpretive techniques and theoretical concerns in Milton scholarship and criticism. Lectures include close readings of lyric and epic poetry, prose, and letters; biographical inquiries; examinations of historical and political contexts; and engagement with critical debates.',
    archive: 'oyc_Milton',
    host: 'yale',
    lectures: [
      {
        title: 'Introduction: Milton, Power, and the Power of Milton',
        page: '/english/engl-220/lecture-1',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall07/engl220/mp3/engl220_01_090507.mp3',
        durationMs: 2657000,
      },
      {
        title: 'The Infant Cry of God',
        page: '/english/engl-220/lecture-2',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall07/engl220/mp3/engl220_02_091007.mp3',
        durationMs: 2863730,
      },
      {
        title: 'Credible Employment',
        page: '/english/engl-220/lecture-3',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall07/engl220/mp3/engl220_03_091207.mp3',
        durationMs: 3000430,
      },
      {
        title: 'Poetry and Virginity',
        page: '/english/engl-220/lecture-4',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall07/engl220/mp3/engl220_04_091707.mp3',
        durationMs: 3068660,
      },
      {
        title: 'Poetry and Marriage',
        page: '/english/engl-220/lecture-5',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall07/engl220/mp3/engl220_05_091907.mp3',
        durationMs: 2819980,
      },
      {
        title: 'Lycidas',
        page: '/english/engl-220/lecture-6',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall07/engl220/mp3/engl220_06_092407.mp3',
        durationMs: 3111480,
      },
      {
        title: 'Lycidas (cont.)',
        page: '/english/engl-220/lecture-7',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall07/engl220/mp3/engl220_07_092607.mp3',
        durationMs: 3156490,
      },
      {
        title: 'Areopagitica',
        page: '/english/engl-220/lecture-8',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall07/engl220/mp3/engl220_08_100107.mp3',
        durationMs: 2795190,
      },
      {
        title: 'Paradise Lost, Book I',
        page: '/english/engl-220/lecture-9',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall07/engl220/mp3/engl220_09_100307.mp3',
        durationMs: 3079270,
      },
      {
        title: 'God and Mammon: The Wealth of Literary Memory',
        page: '/english/engl-220/lecture-10',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall07/engl220/mp3/engl220_10_100807.mp3',
        durationMs: 3037470,
      },
      {
        title: 'The Miltonic Simile',
        page: '/english/engl-220/lecture-11',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall07/engl220/mp3/engl220_11_101007.mp3',
        durationMs: 2739550,
      },
      {
        title: 'The Blind Prophet',
        page: '/english/engl-220/lecture-12',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall07/engl220/mp3/engl220_12_101507.mp3',
        durationMs: 2844350,
      },
      {
        title: 'Paradise Lost, Book III',
        page: '/english/engl-220/lecture-13',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall07/engl220/mp3/engl220_13_102207.mp3',
        durationMs: 2932220,
      },
      {
        title: 'Paradise Lost, Book IV',
        page: '/english/engl-220/lecture-14',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall07/engl220/mp3/engl220_14_102407.mp3',
        durationMs: 3102570,
      },
      {
        title: 'Paradise Lost, Books V-VI',
        page: '/english/engl-220/lecture-15',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall07/engl220/mp3/engl220_15_102907.mp3',
        durationMs: 3155050,
      },
      {
        title: 'Paradise Lost, Books VII-VIII',
        page: '/english/engl-220/lecture-16',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall07/engl220/mp3/engl220_16_103107.mp3',
        durationMs: 2774210,
      },
      {
        title: 'Paradise Lost, Book IX',
        page: '/english/engl-220/lecture-17',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall07/engl220/mp3/engl220_17_110507.mp3',
        durationMs: 2823420,
      },
      {
        title: 'Paradise Lost, Books IX-X',
        page: '/english/engl-220/lecture-18',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall07/engl220/mp3/engl220_18_110707.mp3',
        durationMs: 3101600,
      },
      {
        title: 'Paradise Lost, Books XI-XII',
        page: '/english/engl-220/lecture-19',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall07/engl220/mp3/engl220_19_111207.mp3',
        durationMs: 3068980,
      },
      {
        title: 'Paradise Lost, Books XI-XII (cont.)',
        page: '/english/engl-220/lecture-20',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall07/engl220/mp3/engl220_20_111407.mp3',
        durationMs: 2743990,
      },
      {
        title: 'Paradise Regained, Books I-II',
        page: '/english/engl-220/lecture-21',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall07/engl220/mp3/engl220_21_112607.mp3',
        durationMs: 2985170,
      },
      {
        title: 'Paradise Regained, Books III-IV',
        page: '/english/engl-220/lecture-22',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall07/engl220/mp3/engl220_22_112807.mp3',
        durationMs: 3146040,
      },
      {
        title: 'Samson Agonistes',
        page: '/english/engl-220/lecture-23',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall07/engl220/mp3/engl220_23_120307.mp3',
        durationMs: 2644170,
      },
      {
        title: 'Samson Agonistes (cont.)',
        page: '/english/engl-220/lecture-24',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall07/engl220/mp3/engl220_24_120507.mp3',
        durationMs: 2667240,
      },
    ],
  },
  {
    id: 'engl-310',
    code: 'ENGL 310',
    title: 'Modern Poetry',
    lecturer: 'Langdon Hammer',
    term: 'Spring 2007',
    department: 'English',
    page: '/english/engl-310',
    description:
      'This course covers the body of modern poetry, its characteristic techniques, concerns, and major practitioners. The authors discussed range from Yeats, Eliot, and Pound, to Stevens, Moore, Bishop, and Frost with additional lectures on the poetry of World War One, Imagism, and the Harlem Renaissance. Diverse methods of literary criticism are employed, such as historical, biographical, and gender criticism.',
    archive: 'oyc_Modern_Poetry',
    host: 'yale',
    lectures: [
      {
        title: 'Introduction',
        page: '/english/engl-310/lecture-1',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring07/engl310/mp3/engl310_01_011707.mp3',
        durationMs: 2836150,
      },
      {
        title: 'Robert Frost',
        page: '/english/engl-310/lecture-2',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring07/engl310/mp3/engl310_02_012207.mp3',
        durationMs: 2754960,
      },
      {
        title: 'Robert Frost (cont.)',
        page: '/english/engl-310/lecture-3',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring07/engl310/mp3/engl310_03_012407.mp3',
        durationMs: 3005580,
      },
      {
        title: 'William Butler Yeats',
        page: '/english/engl-310/lecture-4',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring07/engl310/mp3/engl310_04_012907.mp3',
        durationMs: 2731370,
      },
      {
        title: 'William Butler Yeats (cont.)',
        page: '/english/engl-310/lecture-5',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring07/engl310/mp3/engl310_05_013107.mp3',
        durationMs: 2883710,
      },
      {
        title: 'William Butler Yeats (cont.)',
        page: '/english/engl-310/lecture-6',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring07/engl310/mp3/engl310_06_020507.mp3',
        durationMs: 2684220,
      },
      {
        title: 'World War I Poetry in England',
        page: '/english/engl-310/lecture-7',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring07/engl310/mp3/engl310_07_020707.mp3',
        durationMs: 3173520,
      },
      {
        title: 'Imagism',
        page: '/english/engl-310/lecture-8',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring07/engl310/mp3/engl310_08_021207.mp3',
        durationMs: 2764600,
      },
      {
        title: 'Ezra Pound',
        page: '/english/engl-310/lecture-9',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring07/engl310/mp3/engl310_09_021407.mp3',
        durationMs: 3123650,
      },
      {
        title: 'T.S. Eliot',
        page: '/english/engl-310/lecture-10',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring07/engl310/mp3/engl310_10_021907.mp3',
        durationMs: 2976110,
      },
      {
        title: 'T.S. Eliot (cont.)',
        page: '/english/engl-310/lecture-11',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring07/engl310/mp3/engl310_11_022107.mp3',
        durationMs: 2999200,
      },
      {
        title: 'T.S. Eliot (cont.)',
        page: '/english/engl-310/lecture-12',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring07/engl310/mp3/engl310_12_022607.mp3',
        durationMs: 2998240,
      },
      {
        title: 'Hart Crane',
        page: '/english/engl-310/lecture-13',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring07/engl310/mp3/engl310_13_022807.mp3',
        durationMs: 2360930,
      },
      {
        title: 'Hart Crane (cont.)',
        page: '/english/engl-310/lecture-14',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring07/engl310/mp3/engl310_14_030507.mp3',
        durationMs: 2785910,
      },
      {
        title: 'Langston Hughes',
        page: '/english/engl-310/lecture-15',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring07/engl310/mp3/engl310_15_032607.mp3',
        durationMs: 2746860,
      },
      {
        title: 'William Carlos Williams',
        page: '/english/engl-310/lecture-16',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring07/engl310/mp3/engl310_16_032807.mp3',
        durationMs: 2895650,
      },
      {
        title: 'Marianne Moore',
        page: '/english/engl-310/lecture-17',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring07/engl310/mp3/engl310_17_040207.mp3',
        durationMs: 2740560,
      },
      {
        title: 'Marianne Moore (cont.)',
        page: '/english/engl-310/lecture-18',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring07/engl310/mp3/engl310_18_040407.mp3',
        durationMs: 2981460,
      },
      {
        title: 'Wallace Stevens',
        page: '/english/engl-310/lecture-19',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring07/engl310/mp3/engl310_19_040907.mp3',
        durationMs: 3069630,
      },
      {
        title: 'Wallace Stevens (cont.)',
        page: '/english/engl-310/lecture-20',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring07/engl310/mp3/engl310_20_041107.mp3',
        durationMs: 3021930,
      },
      {
        title: 'Wallace Stevens (cont.)',
        page: '/english/engl-310/lecture-21',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring07/engl310/mp3/engl310_21_041607.mp3',
        durationMs: 3077440,
      },
      {
        title: 'W. H. Auden',
        page: '/english/engl-310/lecture-22',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring07/engl310/mp3/engl310_22_041807.mp3',
        durationMs: 2667340,
      },
      {
        title: 'W. H. Auden (cont.)',
        page: '/english/engl-310/lecture-23',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring07/engl310/mp3/engl310_23_042307.mp3',
        durationMs: 3065790,
      },
      {
        title: 'Elizabeth Bishop',
        page: '/english/engl-310/lecture-24',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring07/engl310/mp3/engl310_24_042507.mp3',
        durationMs: 2837610,
      },
      {
        title: 'Elizabeth Bishop (cont.)',
        page: '/english/engl-310/lecture-25',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring07/engl310/mp3/engl310_25_043007.mp3',
        durationMs: 2485300,
      },
    ],
  },
  {
    id: 'engl-291',
    code: 'ENGL 291',
    title: 'The American Novel Since 1945',
    lecturer: 'Amy Hungerford',
    term: 'Spring 2008',
    department: 'English',
    page: '/english/engl-291',
    description:
      'In “The American Novel Since 1945” students will study a wide range of works from 1945 to the present. The course traces the formal and thematic developments of the novel in this period, focusing on the relationship between writers and readers, the conditions of publishing, innovations in the novel’s form, fiction’s engagement with history, and the changing place of literature in American culture. The reading list includes works by Richard Wright, Flannery O’Connor, Vladimir Nabokov, Jack Kerouac, J. D. Salinger, Thomas Pynchon, John Barth, Maxine Hong Kingston, Toni Morrison, Marilynne Robinson, Cormac McCarthy, Philip Roth and Edward P. Jones. The course concludes with a contemporary novel chosen by the students in the class.',
    archive: 'oyc_The_American_Novel_Since_1945',
    host: 'yale',
    lectures: [
      {
        title: 'Introductions',
        page: '/english/engl-291/lecture-1',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring08/engl291/mp3/engl291_01_011408.mp3',
        durationMs: 2855500,
      },
      {
        title: 'Richard Wright, Black Boy',
        page: '/english/engl-291/lecture-2',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring08/engl291/mp3/engl291_02_011608.mp3',
        durationMs: 3029740,
      },
      {
        title: 'Flannery O’Connor, Wise Blood',
        page: '/english/engl-291/lecture-3',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring08/engl291/mp3/engl291_03_011808.mp3',
        durationMs: 2827000,
      },
      {
        title: 'Flannery O’Connor, Wise Blood (cont.)',
        page: '/english/engl-291/lecture-4',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring08/engl291/mp3/engl291_04_012308.mp3',
        durationMs: 2685710,
      },
      {
        title: 'Vladimir Nabokov, Lolita',
        page: '/english/engl-291/lecture-5',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring08/engl291/mp3/engl291_05_012808.mp3',
        durationMs: 3090970,
      },
      {
        title: 'Guest Lecture by Andrew Goldstone',
        page: '/english/engl-291/lecture-6',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring08/engl291/mp3/engl291_06_013008.mp3',
        durationMs: 2605410,
      },
      {
        title: 'Vladimir Nabokov, Lolita (cont.)',
        page: '/english/engl-291/lecture-7',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring08/engl291/mp3/engl291_07_020408.mp3',
        durationMs: 2802810,
      },
      {
        title: 'Jack Kerouac, On the Road',
        page: '/english/engl-291/lecture-8',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring08/engl291/mp3/engl291_08_020608.mp3',
        durationMs: 2867210,
      },
      {
        title: 'Jack Kerouac, On the Road (cont.)',
        page: '/english/engl-291/lecture-9',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring08/engl291/mp3/engl291_09_021108.mp3',
        durationMs: 2751820,
      },
      {
        title: 'J. D. Salinger, Franny and Zooey',
        page: '/english/engl-291/lecture-10',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring08/engl291/mp3/engl291_10_021308.mp3',
        durationMs: 2850070,
      },
      {
        title: 'John Barth, Lost in the Funhouse',
        page: '/english/engl-291/lecture-11',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring08/engl291/mp3/engl291_11_021808.mp3',
        durationMs: 2950220,
      },
      {
        title: 'Thomas Pynchon, The Crying of Lot 49',
        page: '/english/engl-291/lecture-12',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring08/engl291/mp3/engl291_12_022008.mp3',
        durationMs: 2967410,
      },
      {
        title: 'Toni Morrison, The Bluest Eye',
        page: '/english/engl-291/lecture-13',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring08/engl291/mp3/engl291_13_022508.mp3',
        durationMs: 3000590,
      },
      {
        title: 'Maxine Hong Kingston, The Woman Warrior',
        page: '/english/engl-291/lecture-14',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring08/engl291/mp3/engl291_14_022708.mp3',
        durationMs: 3055810,
      },
      {
        title: 'Marilynne Robinson, Housekeeping',
        page: '/english/engl-291/lecture-15',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring08/engl291/mp3/engl291_15_030308.mp3',
        durationMs: 2811620,
      },
      {
        title: 'Marilynne Robinson, Housekeeping (cont.)',
        page: '/english/engl-291/lecture-16',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring08/engl291/mp3/engl291_16_030508.mp3',
        durationMs: 2968980,
      },
      {
        title: 'Cormac McCarthy, Blood Meridian',
        page: '/english/engl-291/lecture-17',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring08/engl291/mp3/engl291_17_032408.mp3',
        durationMs: 3012890,
      },
      {
        title: 'Cormac McCarthy, Blood Meridian (cont.)',
        page: '/english/engl-291/lecture-18',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring08/engl291/mp3/engl291_18_032608.mp3',
        durationMs: 2419260,
      },
      {
        title: 'Philip Roth, The Human Stain',
        page: '/english/engl-291/lecture-19',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring08/engl291/mp3/engl291_19_033108.mp3',
        durationMs: 2932140,
      },
      {
        title: 'Philip Roth, The Human Stain (cont.)',
        page: '/english/engl-291/lecture-20',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring08/engl291/mp3/engl291_20_040208.mp3',
        durationMs: 2975220,
      },
      {
        title: 'Philip Roth, The Human Stain (cont.)',
        page: '/english/engl-291/lecture-21',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring08/engl291/mp3/engl291_21_040908.mp3',
        durationMs: 2758220,
      },
      {
        title: 'Edward P. Jones, The Known World',
        page: '/english/engl-291/lecture-22',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring08/engl291/mp3/engl291_22_041408.mp3',
        durationMs: 3057920,
      },
      {
        title: 'Edward P. Jones, The Known World (cont.)',
        page: '/english/engl-291/lecture-23',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring08/engl291/mp3/engl291_23_041608.mp3',
        durationMs: 2803280,
      },
      {
        title: 'Students’ Choice Novel: Jonathan Safran Foer, Everything is Illuminated',
        page: '/english/engl-291/lecture-24',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring08/engl291/mp3/engl291_24_042108.mp3',
        durationMs: 2747930,
      },
      {
        title: 'Students’ Choice Novel: Jonathan Safran Foer, Everything is Illuminated (cont.)',
        page: '/english/engl-291/lecture-25',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring08/engl291/mp3/engl291_25_042408.mp3',
        durationMs: 2936010,
      },
      {
        title: 'Review for Final Exam',
        page: '/english/engl-291/lecture-26',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring08/engl291/mp3/engl291_26_042808.mp3',
        durationMs: 3317270,
      },
    ],
  },
  {
    id: 'evst-255',
    code: 'EVST 255',
    title: 'Environmental Politics and Law',
    lecturer: 'John Wargo',
    term: 'Spring 2010',
    department: 'Environmental Studies',
    page: '/environmental-studies/evst-255',
    description:
      'Can law change human behavior to be less environmentally damaging? Law will be examined through case histories including: environmental effects of national security, pesticides, air pollution, consumer products, plastics, parks and protected area management, land use, urban growth and sprawl, public/private transit, drinking water standards, food safety, and hazardous site restoration. In each case we will review the structure of law and evaluate its strengths and weaknesses.',
    archive: 'oyc_Environmental_Politics_and_Law',
    host: 'yale',
    lectures: [
      {
        title: 'Introduction to the Course',
        page: '/environmental-studies/evst-255/lecture-1',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring10/evst255/mp3/evst255_01_011210.mp3',
        durationMs: 2701510,
      },
      {
        title: 'Principles and Strategies in Environmental Law',
        page: '/environmental-studies/evst-255/lecture-2',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring10/evst255/mp3/evst255_02_011410.mp3',
        durationMs: 3020880,
      },
      {
        title: 'Nuclear Experiments',
        page: '/environmental-studies/evst-255/lecture-3',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring10/evst255/mp3/evst255_03_011910.mp3',
        durationMs: 2801250,
      },
      {
        title: 'Nuclear Secrecy and Ecology',
        page: '/environmental-studies/evst-255/lecture-4',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring10/evst255/mp3/evst255_04_012610.mp3',
        durationMs: 2568600,
      },
      {
        title: 'Preparing for Nuclear War: NEPA',
        page: '/environmental-studies/evst-255/lecture-5',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring10/evst255/mp3/evst255_05_012810.mp3',
        durationMs: 3099330,
      },
      {
        title: 'Marine Food-Chains: Mercury',
        page: '/environmental-studies/evst-255/lecture-6',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring10/evst255/mp3/evst255_06_020210.mp3',
        durationMs: 2902810,
      },
      {
        title: 'Site Restoration Law',
        page: '/environmental-studies/evst-255/lecture-7',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring10/evst255/mp3/evst255_07_020410.mp3',
        durationMs: 2896020,
      },
      {
        title: 'Chemically Dependent Agriculture',
        page: '/environmental-studies/evst-255/lecture-8',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring10/evst255/mp3/evst255_08_020910.mp3',
        durationMs: 2939670,
      },
      {
        title: 'Risk and Law: Pesticide Paradigm',
        page: '/environmental-studies/evst-255/lecture-9',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring10/evst255/mp3/evst255_09_021110.mp3',
        durationMs: 2974460,
      },
      {
        title: 'Safe Drinking Water: Science and Law',
        page: '/environmental-studies/evst-255/lecture-10',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring10/evst255/mp3/evst255_10_021610.mp3',
        durationMs: 2890690,
      },
      {
        title: 'Safety Claims and Free Speech: Preemption and Defamation',
        page: '/environmental-studies/evst-255/lecture-11',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring10/evst255/mp3/evst255_11_021810.mp3',
        durationMs: 2748350,
      },
      {
        title: 'Air Quality Law: Margins of Safety',
        page: '/environmental-studies/evst-255/lecture-12',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring10/evst255/mp3/evst255_12_022310.mp3',
        durationMs: 2713240,
      },
      {
        title: 'Vehicle Emissions and Public Transit',
        page: '/environmental-studies/evst-255/lecture-13',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring10/evst255/mp3/evst255_13_022510.mp3',
        durationMs: 2823890,
      },
      {
        title: 'The Quiet Revolution in Plastics',
        page: '/environmental-studies/evst-255/lecture-14',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring10/evst255/mp3/evst255_14_030210.mp3',
        durationMs: 3122580,
      },
      {
        title: 'The Tobacco Paradigm',
        page: '/environmental-studies/evst-255/lecture-15',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring10/evst255/mp3/evst255_15_032310.mp3',
        durationMs: 2620950,
      },
      {
        title: 'Evolution of Tobacco Law',
        page: '/environmental-studies/evst-255/lecture-16',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring10/evst255/mp3/evst255_16_032510.mp3',
        durationMs: 2839540,
      },
      {
        title: 'Land Use and Conservation Law: The Adirondack History',
        page: '/environmental-studies/evst-255/lecture-17',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring10/evst255/mp3/evst255_17_033010.mp3',
        durationMs: 2860260,
      },
      {
        title: 'Property Rights and Public Lands Management',
        page: '/environmental-studies/evst-255/lecture-18',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring10/evst255/mp3/evst255_18_040110.mp3',
        durationMs: 2594850,
      },
      {
        title: 'Land Use Law and Property Rights',
        page: '/environmental-studies/evst-255/lecture-19',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring10/evst255/mp3/evst255_19_040610.mp3',
        durationMs: 3023860,
      },
      {
        title: 'Managing Coastal Resources in an Era of Climate Change',
        page: '/environmental-studies/evst-255/lecture-20',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring10/evst255/mp3/evst255_20_040810.mp3',
        durationMs: 2622460,
      },
      {
        title: 'Certification: Design and Green Architecture',
        page: '/environmental-studies/evst-255/lecture-21',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring10/evst255/mp3/evst255_21_041310.mp3',
        durationMs: 2997370,
      },
      {
        title: 'Past and Future of Nuclear Power',
        page: '/environmental-studies/evst-255/lecture-22',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring10/evst255/mp3/evst255_22_041510.mp3',
        durationMs: 2736070,
      },
      {
        title: 'Renewable Energy Policies',
        page: '/environmental-studies/evst-255/lecture-23',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring10/evst255/mp3/evst255_23_042010.mp3',
        durationMs: 2973340,
      },
      {
        title: 'Reflection and Lessons',
        page: '/environmental-studies/evst-255/lecture-24',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring10/evst255/mp3/evst255_24_042210.mp3',
        durationMs: 3001890,
      },
    ],
  },
  {
    id: 'hist-116',
    code: 'HIST 116',
    title: 'The American Revolution',
    lecturer: 'Joanne Freeman',
    term: 'Spring 2010',
    department: 'History',
    page: '/history/hist-116',
    description:
      'The American Revolution entailed some remarkable transformations--converting British colonists into American revolutionaries, and a cluster of colonies into a confederation of states with a common cause--but it was far more complex and enduring than the fighting of a war. As John Adams put it, “The Revolution was in the Minds of the people... before a drop of blood was drawn at Lexington”--and it continued long past America’s victory at Yorktown. This course will examine the Revolution from this broad perspective, tracing the participants’ shifting sense of themselves as British subjects, colonial settlers, revolutionaries, and Americans.',
    archive: 'oyc_The_American_Revolution',
    host: 'yale',
    lectures: [
      {
        title: 'Introduction: Freeman’s Top Five Tips for Studying the Revolution',
        page: '/history/hist-116/lecture-1',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring10/hist116/mp3/hist116_01_011210.mp3',
        durationMs: 2423020,
      },
      {
        title: 'Being a British Colonist',
        page: '/history/hist-116/lecture-2',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring10/hist116/mp3/hist116_02_011410.mp3',
        durationMs: 2369332,
      },
      {
        title: 'Being a British American',
        page: '/history/hist-116/lecture-3',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring10/hist116/mp3/hist116_03_011910.mp3',
        durationMs: 2414480,
      },
      {
        title: '“Ever at Variance and Foolishly Jealous”: Intercolonial Relations',
        page: '/history/hist-116/lecture-4',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring10/hist116/mp3/hist116_04_012110.mp3',
        durationMs: 2499040,
      },
      {
        title: 'Outraged Colonials: The Stamp Act Crisis',
        page: '/history/hist-116/lecture-5',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring10/hist116/mp3/hist116_05_012610.mp3',
        durationMs: 2469330,
      },
      {
        title: 'Resistance or Rebellion? (Or, What the Heck is Happening in Boston?)',
        page: '/history/hist-116/lecture-6',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring10/hist116/mp3/hist116_06_012810.mp3',
        durationMs: 2803360,
      },
      {
        title: 'Being a Revolutionary',
        page: '/history/hist-116/lecture-7',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring10/hist116/mp3/hist116_07_020210.mp3',
        durationMs: 2764960,
      },
      {
        title: 'The Logic of Resistance',
        page: '/history/hist-116/lecture-8',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring10/hist116/mp3/hist116_08_020410.mp3',
        durationMs: 2864570,
      },
      {
        title: 'Who Were the Loyalists?',
        page: '/history/hist-116/lecture-9',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring10/hist116/mp3/hist116_09_020910.mp3',
        durationMs: 2750460,
      },
      {
        title: 'Common Sense',
        page: '/history/hist-116/lecture-10',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring10/hist116/mp3/hist116_10_021110.mp3',
        durationMs: 2588920,
      },
      {
        title: 'Independence',
        page: '/history/hist-116/lecture-11',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring10/hist116/mp3/hist116_11_021610.mp3',
        durationMs: 2515650,
      },
      {
        title: 'Civil War',
        page: '/history/hist-116/lecture-12',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring10/hist116/mp3/hist116_12_021810.mp3',
        durationMs: 2610060,
      },
      {
        title: 'Organizing a War',
        page: '/history/hist-116/lecture-13',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring10/hist116/mp3/hist116_13_022310.mp3',
        durationMs: 2940400,
      },
      {
        title: 'Heroes and Villains',
        page: '/history/hist-116/lecture-14',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring10/hist116/mp3/hist116_14_030210.mp3',
        durationMs: 2938780,
      },
      {
        title: 'Citizens and Choices: Experiencing the Revolution in New Haven',
        page: '/history/hist-116/lecture-15',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring10/hist116/mp3/hist116_15_030410.mp3',
        durationMs: 2579700,
      },
      {
        title: 'The Importance of George Washington',
        page: '/history/hist-116/lecture-16',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring10/hist116/mp3/hist116_16_032310.mp3',
        durationMs: 2680090,
      },
      {
        title: 'The Logic of a Campaign (or, How in the World Did We Win?)',
        page: '/history/hist-116/lecture-17',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring10/hist116/mp3/hist116_17_032510.mp3',
        durationMs: 2809630,
      },
      {
        title: 'Fighting the Revolution: The Big Picture',
        page: '/history/hist-116/lecture-18',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring10/hist116/mp3/hist116_18_033010.mp3',
        durationMs: 2773840,
      },
      {
        title: 'War and Society',
        page: '/history/hist-116/lecture-19',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring10/hist116/mp3/hist116_19_040110.mp3',
        durationMs: 2599480,
      },
      {
        title: 'Confederation',
        page: '/history/hist-116/lecture-20',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring10/hist116/mp3/hist116_20_040610.mp3',
        durationMs: 2605330,
      },
      {
        title: 'A Union Without Power',
        page: '/history/hist-116/lecture-21',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring10/hist116/mp3/hist116_21_040810.mp3',
        durationMs: 2824700,
      },
      {
        title: 'The Road to the Constitutional Convention',
        page: '/history/hist-116/lecture-22',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring10/hist116/mp3/hist116_22_041310.mp3',
        durationMs: 2660920,
      },
      {
        title: 'Creating a Constitution',
        page: '/history/hist-116/lecture-23',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring10/hist116/mp3/hist116_23_041510.mp3',
        durationMs: 2759270,
      },
      {
        title: 'Creating a Nation',
        page: '/history/hist-116/lecture-24',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring10/hist116/mp3/hist116_24_042010.mp3',
        durationMs: 2455650,
      },
      {
        title: 'Being an American: The Legacy of the Revolution',
        page: '/history/hist-116/lecture-25',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring10/hist116/mp3/hist116_25_042210.mp3',
        durationMs: 2478710,
      },
    ],
  },
  {
    id: 'hist-119',
    code: 'HIST 119',
    title: 'The Civil War and Reconstruction Era, 1845-1877',
    lecturer: 'David W. Blight',
    term: 'Spring 2008',
    department: 'History',
    page: '/history/hist-119',
    description:
      'This course explores the causes, course, and consequences of the American Civil War, from the 1840s to 1877. The primary goal of the course is to understand the multiple meanings of a transforming event in American history. Those meanings may be defined in many ways: national, sectional, racial, constitutional, individual, social, intellectual, or moral. Four broad themes are closely examined: the crisis of union and disunion in an expanding republic; slavery, race, and emancipation as national problem, personal experience, and social process; the experience of modern, total war for individuals and society; and the political and social challenges of Reconstruction.',
    archive: 'oyc_The_Civil_War_and_Reconstruction_Era',
    host: 'yale',
    lectures: [
      {
        title:
          'Introductions: Why Does the Civil War Era Have a Hold on American Historical Imagination?',
        page: '/history/hist-119/lecture-1',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring08/hist119/mp3/hist119_01_011508.mp3',
        durationMs: 2586490,
      },
      {
        title: 'Southern Society: Slavery, King Cotton, and Antebellum America’s “Peculiar” Region',
        page: '/history/hist-119/lecture-2',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring08/hist119/mp3/hist119_02_011708.mp3',
        durationMs: 3114980,
      },
      {
        title: 'A Southern World View: The Old South and Proslavery Ideology',
        page: '/history/hist-119/lecture-3',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring08/hist119/mp3/hist119_03_012208.mp3',
        durationMs: 3060170,
      },
      {
        title:
          'A Northern World View: Yankee Society, Antislavery Ideology and the Abolition Movement',
        page: '/history/hist-119/lecture-4',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring08/hist119/mp3/hist119_04_012408.mp3',
        durationMs: 3083060,
      },
      {
        title:
          'Telling a Free Story: Fugitive Slaves and the Underground Railroad in Myth and Reality',
        page: '/history/hist-119/lecture-5',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring08/hist119/mp3/hist119_05_012908.mp3',
        durationMs: 3012520,
      },
      {
        title: 'Expansion and Slavery: Legacies of the Mexican War and the Compromise of 1850',
        page: '/history/hist-119/lecture-6',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring08/hist119/mp3/hist119_06_013108.mp3',
        durationMs: 3183500,
      },
      {
        title:
          '“A Hell of a Storm”: The Kansas-Nebraska Act and the Birth of the Republican Party, 1854-55',
        page: '/history/hist-119/lecture-7',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring08/hist119/mp3/hist119_07_020508.mp3',
        durationMs: 2861430,
      },
      {
        title: 'Dred Scott, Bleeding Kansas, and the Impending Crisis of the Union, 1855-58',
        page: '/history/hist-119/lecture-8',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring08/hist119/mp3/hist119_08_020708.mp3',
        durationMs: 3134880,
      },
      {
        title: 'John Brown’s Holy War: Terrorist or Heroic Revolutionary?',
        page: '/history/hist-119/lecture-9',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring08/hist119/mp3/hist119_09_021208.mp3',
        durationMs: 3143480,
      },
      {
        title: 'The Election of 1860 and the Secession Crisis',
        page: '/history/hist-119/lecture-10',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring08/hist119/mp3/hist119_10_021408.mp3',
        durationMs: 3048390,
      },
      {
        title: 'Slavery and State Rights, Economies and Ways of Life: What Caused the Civil War?',
        page: '/history/hist-119/lecture-11',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring08/hist119/mp3/hist119_11_021908.mp3',
        durationMs: 3017750,
      },
      {
        title: '“And the War Came,” 1861: The Sumter Crisis, Comparative Strategies',
        page: '/history/hist-119/lecture-12',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring08/hist119/mp3/hist119_12_022108.mp3',
        durationMs: 2796830,
      },
      {
        title: 'Terrible Swift Sword: The Period of Confederate Ascendency, 1861-1862',
        page: '/history/hist-119/lecture-13',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring08/hist119/mp3/hist119_13_022608.mp3',
        durationMs: 3160090,
      },
      {
        title: 'Never Call Retreat: Military and Political Turning Points in 1863',
        page: '/history/hist-119/lecture-14',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring08/hist119/mp3/hist119_14_022808.mp3',
        durationMs: 3015400,
      },
      {
        title: 'Lincoln, Leadership, and Race: Emancipation as Policy',
        page: '/history/hist-119/lecture-15',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring08/hist119/mp3/hist119_15_030408.mp3',
        durationMs: 3096670,
      },
      {
        title: 'Days of Jubilee: The Meanings of Emancipation and Total War',
        page: '/history/hist-119/lecture-16',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring08/hist119/mp3/hist119_16_030608.mp3',
        durationMs: 2907040,
      },
      {
        title: 'Homefronts and Battlefronts: “Hard War” and the Social Impact of the Civil War',
        page: '/history/hist-119/lecture-17',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring08/hist119/mp3/hist119_17_032508.mp3',
        durationMs: 3046540,
      },
      {
        title: '“War So Terrible”: Why the Union Won and the Confederacy Lost at Home and Abroad',
        page: '/history/hist-119/lecture-18',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring08/hist119/mp3/hist119_18_032708.mp3',
        durationMs: 3019760,
      },
      {
        title: 'To Appomattox and Beyond: The End of the War and a Search for Meanings',
        page: '/history/hist-119/lecture-19',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring08/hist119/mp3/hist119_19_040108.mp3',
        durationMs: 3071850,
      },
      {
        title: 'Wartime Reconstruction: Imagining the Aftermath and a Second American Republic',
        page: '/history/hist-119/lecture-20',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring08/hist119/mp3/hist119_20_040308.mp3',
        durationMs: 2902600,
      },
      {
        title: 'Andrew Johnson and the Radicals: A Contest over the Meaning of Reconstruction',
        page: '/history/hist-119/lecture-21',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring08/hist119/mp3/hist119_21_040808.mp3',
        durationMs: 3044050,
      },
      {
        title: 'Constitutional Crisis and Impeachment of a President',
        page: '/history/hist-119/lecture-22',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring08/hist119/mp3/hist119_22_041008.mp3',
        durationMs: 3115630,
      },
      {
        title:
          'Black Reconstruction in the South: The Freedpeople and the Economics of Land and Labor',
        page: '/history/hist-119/lecture-23',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring08/hist119/mp3/hist119_23_041508.mp3',
        durationMs: 3080550,
      },
      {
        title: 'Retreat from Reconstruction: The Grant Era and Paths to “Southern Redemption”',
        page: '/history/hist-119/lecture-24',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring08/hist119/mp3/hist119_24_041708.mp3',
        durationMs: 3002310,
      },
      {
        title:
          'The “End” of Reconstruction: Disputed Election of 1876, and the “Compromise of 1877”',
        page: '/history/hist-119/lecture-25',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring08/hist119/mp3/hist119_25_042208.mp3',
        durationMs: 3139240,
      },
      {
        title: 'Race and Reunion: The Civil War in American Memory',
        page: '/history/hist-119/lecture-26',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring08/hist119/mp3/hist119_26_042408.mp3',
        durationMs: 3089660,
      },
      {
        title: 'Legacies of the Civil War',
        page: '/history/hist-119/lecture-27',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring08/hist119/mp3/hist119_27_042908.mp3',
        durationMs: 2955630,
      },
    ],
  },
  {
    id: 'hist-210',
    code: 'HIST 210',
    title: 'The Early Middle Ages, 284–1000',
    lecturer: 'Paul Freedman',
    term: 'Fall 2011',
    department: 'History',
    page: '/history/hist-210',
    description:
      'Major developments in the political, social, and religious history of Western Europe from the accession of Diocletian to the feudal transformation. Topics include the conversion of Europe to Christianity, the fall of the Roman Empire, the rise of Islam and the Arabs, the “Dark Ages,” Charlemagne and the Carolingian renaissance, and the Viking and Hungarian invasions.',
    archive: 'oyc_The_Early_Middle_Ages',
    host: 'yale',
    lectures: [
      {
        title: 'Course Introduction: Rome’s Greatness and First Crises',
        page: '/history/hist-210/lecture-1',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall11/hist210/mp3/hist210_01_083111.mp3',
        durationMs: 2430700,
      },
      {
        title: 'The Crisis of the Third Century and the Diocletianic Reforms',
        page: '/history/hist-210/lecture-2',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall11/hist210/mp3/hist210_02_090511.mp3',
        durationMs: 2916990,
      },
      {
        title: 'Constantine and the Early Church',
        page: '/history/hist-210/lecture-3',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall11/hist210/mp3/hist210_03_090711.mp3',
        durationMs: 2717110,
      },
      {
        title: 'The Christian Roman Empire',
        page: '/history/hist-210/lecture-4',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall11/hist210/mp3/hist210_04_091211.mp3',
        durationMs: 2875300,
      },
      {
        title: 'St. Augustine’s Confessions',
        page: '/history/hist-210/lecture-5',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall11/hist210/mp3/hist210_05_091411.mp3',
        durationMs: 2782860,
      },
      {
        title: 'Transformation of the Roman Empire',
        page: '/history/hist-210/lecture-6',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall11/hist210/mp3/hist210_06_091911.mp3',
        durationMs: 2961320,
      },
      {
        title: 'Barbarian Kingdoms',
        page: '/history/hist-210/lecture-7',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall11/hist210/mp3/hist210_07_092111.mp3',
        durationMs: 2954720,
      },
      {
        title: 'Survival in the East',
        page: '/history/hist-210/lecture-8',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall11/hist210/mp3/hist210_08_092611.mp3',
        durationMs: 2829690,
      },
      {
        title: 'The Reign of Justinian',
        page: '/history/hist-210/lecture-9',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall11/hist210/mp3/hist210_09_092811.mp3',
        durationMs: 2926560,
      },
      {
        title: 'Clovis and the Franks',
        page: '/history/hist-210/lecture-10',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall11/hist210/mp3/hist210_10_100311.mp3',
        durationMs: 2814150,
      },
      {
        title: 'Frankish Society',
        page: '/history/hist-210/lecture-11',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall11/hist210/mp3/hist210_11_101011.mp3',
        durationMs: 3000610,
      },
      {
        title: 'Britain and Ireland',
        page: '/history/hist-210/lecture-12',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall11/hist210/mp3/hist210_12_101211.mp3',
        durationMs: 2654330,
      },
      {
        title: 'Monasticism',
        page: '/history/hist-210/lecture-13',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall11/hist210/mp3/hist210_13_101911.mp3',
        durationMs: 2749260,
      },
      {
        title: 'Mohammed and the Arab Conquests',
        page: '/history/hist-210/lecture-14',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall11/hist210/mp3/hist210_14_102411.mp3',
        durationMs: 2594460,
      },
      {
        title: 'Islamic Conquests and Civil War',
        page: '/history/hist-210/lecture-15',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall11/hist210/mp3/hist210_15_102611.mp3',
        durationMs: 2983950,
      },
      {
        title: 'The Splendor of the Abbasid Period',
        page: '/history/hist-210/lecture-16',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall11/hist210/mp3/hist210_16_103111.mp3',
        durationMs: 2650420,
      },
      {
        title: 'The Crucial Seventh Century',
        page: '/history/hist-210/lecture-17',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall11/hist210/mp3/hist210_17_110211.mp3',
        durationMs: 2717420,
      },
      {
        title: 'The Splendor of Byzantium',
        page: '/history/hist-210/lecture-18',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall11/hist210/mp3/hist210_18_110711.mp3',
        durationMs: 2919530,
      },
      {
        title: 'Charlemagne',
        page: '/history/hist-210/lecture-19',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall11/hist210/mp3/hist210_19_110911.mp3',
        durationMs: 2774650,
      },
      {
        title: 'Intellectuals and the Court of Charlemagne',
        page: '/history/hist-210/lecture-20',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall11/hist210/mp3/hist210_20_111411.mp3',
        durationMs: 2641950,
      },
      {
        title: 'Crisis of the Carolingians',
        page: '/history/hist-210/lecture-21',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall11/hist210/mp3/hist210_21_111611.mp3',
        durationMs: 2762060,
      },
      {
        title: 'Vikings / The European Prospect, 1000',
        page: '/history/hist-210/lecture-22',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall11/hist210/mp3/hist210_22_112811.mp3',
        durationMs: 2939070,
      },
    ],
  },
  {
    id: 'hist-202',
    code: 'HIST 202',
    title: 'European Civilization, 1648-1945',
    lecturer: 'John Merriman',
    term: 'Fall 2008',
    department: 'History',
    page: '/history/hist-202',
    description:
      'This course offers a broad survey of modern European history, from the end of the Thirty Years’ War to the aftermath of World War II. Along with the consideration of major events and figures such as the French Revolution and Napoleon, attention will be paid to the experience of ordinary people in times of upheaval and transition. The period will thus be viewed neither in terms of historical inevitability nor as a procession of great men, but rather through the lens of the complex interrelations between demographic change, political revolution, and cultural development. Textbook accounts will be accompanied by the study of exemplary works of art, literature, and cinema.',
    archive: 'oyc_European_Civilization__1648-1945',
    host: 'yale',
    lectures: [
      {
        title: 'Introduction',
        page: '/history/hist-202/lecture-1',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall08/hist202/mp3/hist202_01_090308.mp3',
        durationMs: 2178280,
      },
      {
        title: 'Absolutism and the State',
        page: '/history/hist-202/lecture-2',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall08/hist202/mp3/hist202_02_090808.mp3',
        durationMs: 2712040,
      },
      {
        title: 'Dutch and British Exceptionalism',
        page: '/history/hist-202/lecture-3',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall08/hist202/mp3/hist202_03_091008.mp3',
        durationMs: 2792390,
      },
      {
        title: 'Peter the Great',
        page: '/history/hist-202/lecture-4',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall08/hist202/mp3/hist202_04_091508.mp3',
        durationMs: 2742260,
      },
      {
        title: 'The Enlightenment and the Public Sphere',
        page: '/history/hist-202/lecture-5',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall08/hist202/mp3/hist202_05_091708.mp3',
        durationMs: 2878440,
      },
      {
        title: 'Maximilien Robespierre and the French Revolution',
        page: '/history/hist-202/lecture-6',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall08/hist202/mp3/hist202_06_092208.mp3',
        durationMs: 2996670,
      },
      {
        title: 'Napoleon',
        page: '/history/hist-202/lecture-7',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall08/hist202/mp3/hist202_07_092408.mp3',
        durationMs: 2904190,
      },
      {
        title: 'Industrial Revolutions',
        page: '/history/hist-202/lecture-8',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall08/hist202/mp3/hist202_08_092908.mp3',
        durationMs: 2894160,
      },
      {
        title: 'Middle Classes',
        page: '/history/hist-202/lecture-9',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall08/hist202/mp3/hist202_09_100108.mp3',
        durationMs: 3035170,
      },
      {
        title: 'Popular Protest',
        page: '/history/hist-202/lecture-10',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall08/hist202/mp3/hist202_10_100608.mp3',
        durationMs: 2835990,
      },
      {
        title: 'Why No Revolution in 1848 in Britain',
        page: '/history/hist-202/lecture-11',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall08/hist202/mp3/hist202_11_100808.mp3',
        durationMs: 2548410,
      },
      {
        title: 'Nineteenth-Century Cities',
        page: '/history/hist-202/lecture-12',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall08/hist202/mp3/hist202_12_101308.mp3',
        durationMs: 3089060,
      },
      {
        title: 'Nationalism',
        page: '/history/hist-202/lecture-13',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall08/hist202/mp3/hist202_13_102008.mp3',
        durationMs: 3050090,
      },
      {
        title: 'Radicals',
        page: '/history/hist-202/lecture-14',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall08/hist202/mp3/hist202_14_102208.mp3',
        durationMs: 2975200,
      },
      {
        title: 'Imperialists and Boy Scouts',
        page: '/history/hist-202/lecture-15',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall08/hist202/mp3/hist202_15_102708.mp3',
        durationMs: 3063360,
      },
      {
        title: 'The Coming of the Great War',
        page: '/history/hist-202/lecture-16',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall08/hist202/mp3/hist202_16_102908.mp3',
        durationMs: 2882670,
      },
      {
        title: 'War in the Trenches',
        page: '/history/hist-202/lecture-17',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall08/hist202/mp3/hist202_17_110308.mp3',
        durationMs: 3022530,
      },
      {
        title: 'Sites of Memory, Sites of Mourning (Guest Lecture by Jay Winters)',
        page: '/history/hist-202/lecture-18',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall08/hist202/mp3/hist202_18_110508.mp3',
        durationMs: 2788920,
      },
      {
        title: 'The Romanovs and the Russian Revolution',
        page: '/history/hist-202/lecture-19',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall08/hist202/mp3/hist202_19_111008.mp3',
        durationMs: 2817520,
      },
      {
        title: 'Successor States of Eastern Europe',
        page: '/history/hist-202/lecture-20',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall08/hist202/mp3/hist202_20_111208.mp3',
        durationMs: 2674160,
      },
      {
        title: 'Stalinism',
        page: '/history/hist-202/lecture-21',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall08/hist202/mp3/hist202_21_111708.mp3',
        durationMs: 2806780,
      },
      {
        title: 'Fascists',
        page: '/history/hist-202/lecture-22',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall08/hist202/mp3/hist202_22_111908.mp3',
        durationMs: 2848740,
      },
      {
        title: 'Collaboration and Resistance in World War II',
        page: '/history/hist-202/lecture-23',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall08/hist202/mp3/hist202_23_120108.mp3',
        durationMs: 2730040,
      },
      {
        title: 'The Collapse of Communism and Global Challenges',
        page: '/history/hist-202/lecture-24',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall08/hist202/mp3/hist202_24_120308.mp3',
        durationMs: 2474480,
      },
    ],
  },
  {
    id: 'hist-234',
    code: 'HIST 234',
    title: 'Epidemics in Western Society Since 1600',
    lecturer: 'Frank Snowden',
    term: 'Spring 2010',
    department: 'History',
    page: '/history/hist-234',
    description:
      'This course consists of an international analysis of the impact of epidemic diseases on western society and culture from the bubonic plague to HIV/AIDS and the recent experience of SARS and swine flu. Leading themes include: infectious disease and its impact on society; the development of public health measures; the role of medical ethics; the genre of plague literature; the social reactions of mass hysteria and violence; the rise of the germ theory of disease; the development of tropical medicine; a comparison of the social, cultural, and historical impact of major infectious diseases; and the issue of emerging and re-emerging diseases.',
    archive: 'oyc_Epidemics_in_Western_Society_Since_1600',
    host: 'yale',
    lectures: [
      {
        title: 'Introduction to the Course',
        page: '/history/hist-234/lecture-1',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring10/hist234/mp3/hist234_01_011110.mp3',
        durationMs: 1723120,
      },
      {
        title: 'Classical Views of Disease: Hippocrates, Galen, and Humoralism',
        page: '/history/hist-234/lecture-2',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring10/hist234/mp3/hist234_02_011310.mp3',
        durationMs: 2891630,
      },
      {
        title: 'Plague (I): Pestilence as Disease',
        page: '/history/hist-234/lecture-3',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring10/hist234/mp3/hist234_03_012010.mp3',
        durationMs: 2930290,
      },
      {
        title: 'Plague (II): Responses and Measures',
        page: '/history/hist-234/lecture-4',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring10/hist234/mp3/hist234_04_012510.mp3',
        durationMs: 3011690,
      },
      {
        title: 'Plague (III): Illustrations and Conclusions',
        page: '/history/hist-234/lecture-5',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring10/hist234/mp3/hist234_05_012710.mp3',
        durationMs: 2651280,
      },
      {
        title: 'Smallpox (I): “The Speckled Monster”',
        page: '/history/hist-234/lecture-6',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring10/hist234/mp3/hist234_06_020110.mp3',
        durationMs: 2826790,
      },
      {
        title: 'Smallpox (II): Jenner, Vaccination, and Eradication',
        page: '/history/hist-234/lecture-7',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring10/hist234/mp3/hist234_07_020310.mp3',
        durationMs: 3033950,
      },
      {
        title: 'Nineteenth-Century Medicine: The Paris School of Medicine',
        page: '/history/hist-234/lecture-8',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring10/hist234/mp3/hist234_08_020810.mp3',
        durationMs: 2951840,
      },
      {
        title: 'Asiatic Cholera (I): Personal Reflections',
        page: '/history/hist-234/lecture-9',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring10/hist234/mp3/hist234_09_021010.mp3',
        durationMs: 2969610,
      },
      {
        title: 'Asiatic Cholera (II): Five Pandemics',
        page: '/history/hist-234/lecture-10',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring10/hist234/mp3/hist234_10_021510.mp3',
        durationMs: 3045280,
      },
      {
        title: 'The Sanitary Movement and the “Filth Theory of Disease”',
        page: '/history/hist-234/lecture-11',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring10/hist234/mp3/hist234_11_021710.mp3',
        durationMs: 2936430,
      },
      {
        title: 'Syphilis: From the “Great Pox” to the Modern Version',
        page: '/history/hist-234/lecture-12',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring10/hist234/mp3/hist234_12_022210.mp3',
        durationMs: 2957480,
      },
      {
        title: 'Contagionism versus Anticontagionism',
        page: '/history/hist-234/lecture-13',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring10/hist234/mp3/hist234_13_022410.mp3',
        durationMs: 2962710,
      },
      {
        title: 'The Germ Theory of Disease',
        page: '/history/hist-234/lecture-14',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring10/hist234/mp3/hist234_14_030110.mp3',
        durationMs: 2952420,
      },
      {
        title: 'Tropical Medicine as a Discipline',
        page: '/history/hist-234/lecture-15',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring10/hist234/mp3/hist234_15_030310.mp3',
        durationMs: 2768070,
      },
      {
        title: 'Malaria (I): The Case of Italy',
        page: '/history/hist-234/lecture-16',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring10/hist234/mp3/hist234_16_032210.mp3',
        durationMs: 2987810,
      },
      {
        title: 'Malaria (II): The Global Challenge',
        page: '/history/hist-234/lecture-17',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring10/hist234/mp3/hist234_17_032410.mp3',
        durationMs: 2798660,
      },
      {
        title: 'Tuberculosis (I): The Era of Consumption',
        page: '/history/hist-234/lecture-18',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring10/hist234/mp3/hist234_18_032910.mp3',
        durationMs: 2937210,
      },
      {
        title: 'Tuberculosis (II): After Robert Koch',
        page: '/history/hist-234/lecture-19',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring10/hist234/mp3/hist234_19_033110.mp3',
        durationMs: 2950820,
      },
      {
        title: 'Pandemic Influenza',
        page: '/history/hist-234/lecture-20',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring10/hist234/mp3/hist234_20_040510.mp3',
        durationMs: 3053280,
      },
      {
        title: 'The Tuskegee Experiment',
        page: '/history/hist-234/lecture-21',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring10/hist234/mp3/hist234_21_040710.mp3',
        durationMs: 3065870,
      },
      {
        title: 'AIDS (I)',
        page: '/history/hist-234/lecture-22',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring10/hist234/mp3/hist234_22_041210.mp3',
        durationMs: 3085510,
      },
      {
        title: 'AIDS (II)',
        page: '/history/hist-234/lecture-23',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring10/hist234/mp3/hist234_23_041410.mp3',
        durationMs: 2964510,
      },
      {
        title: 'Poliomyelitis: Problems of Eradication',
        page: '/history/hist-234/lecture-24',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring10/hist234/mp3/hist234_24_041910.mp3',
        durationMs: 3105600,
      },
      {
        title: 'SARS, Avian Influenza, and Swine Flu: Lessons and Prospects',
        page: '/history/hist-234/lecture-25',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring10/hist234/mp3/hist234_25_042110.mp3',
        durationMs: 2447420,
      },
      {
        title: 'Final Q&A',
        page: '/history/hist-234/lecture-26',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring10/hist234/mp3/hist234_26_042610.mp3',
        durationMs: 3035830,
      },
    ],
  },
  {
    id: 'hist-251',
    code: 'HIST 251',
    title: 'Early Modern England: Politics, Religion, and Society under the Tudors and Stuarts',
    lecturer: 'Keith E. Wrightson',
    term: 'Fall 2009',
    department: 'History',
    page: '/history/hist-251',
    description:
      'This course is intended to provide an up-to-date introduction to the development of English society between the late fifteenth and the early eighteenth centuries. Particular issues addressed in the lectures will include: the changing social structure; households; local communities; gender roles; economic development; urbanization; religious change from the Reformation to the Act of Toleration; the Tudor and Stuart monarchies; rebellion, popular protest and civil war; witchcraft; education, literacy and print culture; crime and the law; poverty and social welfare; the changing structures and dynamics of political participation and the emergence of parliamentary government.',
    archive: 'oyc_Early_Modern_England',
    host: 'yale',
    lectures: [
      {
        title: 'General Introduction',
        page: '/history/hist-251/lecture-1',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall09/hist251/mp3/hist251_01_090309.mp3',
        durationMs: 2169000,
      },
      {
        title: '“The Tree of Commonwealth”: The Social Order in the Sixteenth Century',
        page: '/history/hist-251/lecture-2',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall09/hist251/mp3/hist251_02_090809.mp3',
        durationMs: 2616350,
      },
      {
        title: 'Households: Structures, Priorities, Strategies, Roles',
        page: '/history/hist-251/lecture-3',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall09/hist251/mp3/hist251_03_091009.mp3',
        durationMs: 2764340,
      },
      {
        title: 'Communities: Key Institutions and Relationships',
        page: '/history/hist-251/lecture-4',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall09/hist251/mp3/hist251_04_091509.mp3',
        durationMs: 2757750,
      },
      {
        title: '“Countries” and Nation: Social and Economic Networks and the Urban System',
        page: '/history/hist-251/lecture-5',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall09/hist251/mp3/hist251_05_091709.mp3',
        durationMs: 2745450,
      },
      {
        title: 'The Structures of Power',
        page: '/history/hist-251/lecture-6',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall09/hist251/mp3/hist251_06_092209.mp3',
        durationMs: 3102520,
      },
      {
        title: 'Late Medieval Religion and Its Critics',
        page: '/history/hist-251/lecture-7',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall09/hist251/mp3/hist251_07_092409.mp3',
        durationMs: 2751380,
      },
      {
        title: 'Reformation and Division, 1530-1558',
        page: '/history/hist-251/lecture-8',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall09/hist251/mp3/hist251_08_092909.mp3',
        durationMs: 3001340,
      },
      {
        title: '“Commodity” and “Commonwealth”: Economic and Social Problems, 1520-1560',
        page: '/history/hist-251/lecture-9',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall09/hist251/mp3/hist251_09_100109.mp3',
        durationMs: 2802000,
      },
      {
        title: 'The Elizabethan Confessional State: Conformity, Papists and Puritans',
        page: '/history/hist-251/lecture-10',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall09/hist251/mp3/hist251_10_100609.mp3',
        durationMs: 3102460,
      },
      {
        title: 'The Elizabethan “Monarchical Republic”: Political Participation',
        page: '/history/hist-251/lecture-11',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall09/hist251/mp3/hist251_11_100809.mp3',
        durationMs: 2653890,
      },
      {
        title: 'Economic Expansion, 1560-1640',
        page: '/history/hist-251/lecture-12',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall09/hist251/mp3/hist251_12_101309.mp3',
        durationMs: 3057720,
      },
      {
        title: 'A Polarizing Society, 1560-1640',
        page: '/history/hist-251/lecture-13',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall09/hist251/mp3/hist251_13_101509.mp3',
        durationMs: 2821130,
      },
      {
        title: 'Witchcraft and Magic',
        page: '/history/hist-251/lecture-14',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall09/hist251/mp3/hist251_14_102009.mp3',
        durationMs: 2795060,
      },
      {
        title: 'Crime and the Law',
        page: '/history/hist-251/lecture-15',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall09/hist251/mp3/hist251_15_102209.mp3',
        durationMs: 2791740,
      },
      {
        title: 'Popular Protest',
        page: '/history/hist-251/lecture-16',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall09/hist251/mp3/hist251_16_102709.mp3',
        durationMs: 2788420,
      },
      {
        title: 'Education and Literacy',
        page: '/history/hist-251/lecture-17',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall09/hist251/mp3/hist251_17_102909.mp3',
        durationMs: 2984780,
      },
      {
        title: 'Street Wars of Religion: Puritans and Arminians',
        page: '/history/hist-251/lecture-18',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall09/hist251/mp3/hist251_18_110309.mp3',
        durationMs: 2717550,
      },
      {
        title: 'Crown and Political Nation, 1604-1640',
        page: '/history/hist-251/lecture-19',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall09/hist251/mp3/hist251_19_110509.mp3',
        durationMs: 2633280,
      },
      {
        title: 'Constitutional Revolution and Civil War, 1640-1646',
        page: '/history/hist-251/lecture-20',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall09/hist251/mp3/hist251_20_111009.mp3',
        durationMs: 2986560,
      },
      {
        title: 'Regicide and Republic, 1647-1660',
        page: '/history/hist-251/lecture-21',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall09/hist251/mp3/hist251_21_111209.mp3',
        durationMs: 2831840,
      },
      {
        title: 'An Unsettled Settlement: The Restoration Era, 1660-1688',
        page: '/history/hist-251/lecture-22',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall09/hist251/mp3/hist251_22_111709.mp3',
        durationMs: 2887690,
      },
      {
        title: 'England, Britain, and the World: Economic Development, 1660-1720',
        page: '/history/hist-251/lecture-23',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall09/hist251/mp3/hist251_23_111909.mp3',
        durationMs: 2796130,
      },
      {
        title: 'Refashioning the State, 1688-1714',
        page: '/history/hist-251/lecture-24',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall09/hist251/mp3/hist251_24_120109.mp3',
        durationMs: 2811410,
      },
      {
        title: 'Concluding Discussion and Advice on Examination',
        page: '/history/hist-251/lecture-25',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall09/hist251/mp3/hist251_25_120309.mp3',
        durationMs: 1122670,
      },
    ],
  },
  {
    id: 'hist-276',
    code: 'HIST 276',
    title: 'France Since 1871',
    lecturer: 'John Merriman',
    term: 'Fall 2007',
    department: 'History',
    page: '/history/hist-276',
    description:
      'This course covers the emergence of modern France. Topics include the social, economic, and political transformation of France; the impact of France’s revolutionary heritage, of industrialization, and of the dislocation wrought by two world wars; and the political response of the Left and the Right to changing French society.',
    archive: 'oyc_France_Since_1871',
    host: 'yale',
    lectures: [
      {
        title: 'Introduction',
        page: '/history/hist-276/lecture-1',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall07/hist276/mp3/hist276_01_090507.mp3',
        durationMs: 2556030,
      },
      {
        title: 'The Paris Commune and Its Legacy',
        page: '/history/hist-276/lecture-2',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall07/hist276/mp3/hist276_02_091007.mp3',
        durationMs: 2687720,
      },
      {
        title: 'Centralized State and Republic',
        page: '/history/hist-276/lecture-3',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall07/hist276/mp3/hist276_03_091207.mp3',
        durationMs: 2906890,
      },
      {
        title: 'A Nation? Peasants, Language, and French Identity',
        page: '/history/hist-276/lecture-4',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall07/hist276/mp3/hist276_04_091707.mp3',
        durationMs: 2900880,
      },
      {
        title: 'The Waning of Religious Authority',
        page: '/history/hist-276/lecture-5',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall07/hist276/mp3/hist276_05_091907.mp3',
        durationMs: 2532240,
      },
      {
        title: 'Workshop and Factory',
        page: '/history/hist-276/lecture-6',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall07/hist276/mp3/hist276_06_092407.mp3',
        durationMs: 3088880,
      },
      {
        title: 'Mass Politics and the Political Challenge from the Left',
        page: '/history/hist-276/lecture-7',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall07/hist276/mp3/hist276_07_092607.mp3',
        durationMs: 2863630,
      },
      {
        title: 'Dynamite Club: The Anarchists',
        page: '/history/hist-276/lecture-8',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall07/hist276/mp3/hist276_08_100107.mp3',
        durationMs: 3050790,
      },
      {
        title: 'General Boulanger and Captain Dreyfus',
        page: '/history/hist-276/lecture-9',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall07/hist276/mp3/hist276_09_100307.mp3',
        durationMs: 2842280,
      },
      {
        title: 'Cafés and the Culture of Drink',
        page: '/history/hist-276/lecture-10',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall07/hist276/mp3/hist276_10_100807.mp3',
        durationMs: 2969740,
      },
      {
        title: 'Paris and the Belle Époque',
        page: '/history/hist-276/lecture-11',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall07/hist276/mp3/hist276_11_101007.mp3',
        durationMs: 3058970,
      },
      {
        title: 'French Imperialism (Guest Lecture by Charles Keith)',
        page: '/history/hist-276/lecture-12',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall07/hist276/mp3/hist276_12_101507.mp3',
        durationMs: 2635730,
      },
      {
        title: 'The Origins of World War I',
        page: '/history/hist-276/lecture-13',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall07/hist276/mp3/hist276_13_101707.mp3',
        durationMs: 2751720,
      },
      {
        title: 'Trench Warfare',
        page: '/history/hist-276/lecture-14',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall07/hist276/mp3/hist276_14_102207.mp3',
        durationMs: 2711180,
      },
      {
        title: 'The Home Front',
        page: '/history/hist-276/lecture-15',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall07/hist276/mp3/hist276_15_102407.mp3',
        durationMs: 3016420,
      },
      {
        title: 'The Great War, Grief, and Memory (Guest Lecture by Bruno Cabanes)',
        page: '/history/hist-276/lecture-16',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall07/hist276/mp3/hist276_16_103107.mp3',
        durationMs: 2758300,
      },
      {
        title: 'The Popular Front',
        page: '/history/hist-276/lecture-17',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall07/hist276/mp3/hist276_17_110507.mp3',
        durationMs: 2858720,
      },
      {
        title: 'The Dark Years: Vichy France',
        page: '/history/hist-276/lecture-18',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall07/hist276/mp3/hist276_18_110707.mp3',
        durationMs: 3085980,
      },
      {
        title: 'Resistance',
        page: '/history/hist-276/lecture-19',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall07/hist276/mp3/hist276_19_111207.mp3',
        durationMs: 2982950,
      },
      {
        title: 'Battles For and Against Americanization',
        page: '/history/hist-276/lecture-20',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall07/hist276/mp3/hist276_20_111407.mp3',
        durationMs: 2857930,
      },
      {
        title: 'Vietnam and Algeria',
        page: '/history/hist-276/lecture-21',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall07/hist276/mp3/hist276_21_112607.mp3',
        durationMs: 2299590,
      },
      {
        title: 'Charles De Gaulle',
        page: '/history/hist-276/lecture-22',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall07/hist276/mp3/hist276_22_112807.mp3',
        durationMs: 2819980,
      },
      {
        title: 'May 1968',
        page: '/history/hist-276/lecture-23',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall07/hist276/mp3/hist276_23_120307.mp3',
        durationMs: 3021250,
      },
      {
        title: 'Immigration',
        page: '/history/hist-276/lecture-24',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall07/hist276/mp3/hist276_24_120507.mp3',
        durationMs: 2856730,
      },
    ],
  },
  {
    id: 'hsar-252',
    code: 'HSAR 252',
    title: 'Roman Architecture',
    lecturer: 'Diana E. E. Kleiner',
    term: 'Spring 2009',
    department: 'History of Art',
    page: '/history-of-art/hsar-252',
    description:
      'This course is an introduction to the great buildings and engineering marvels of Rome and its empire, with an emphasis on urban planning and individual monuments and their decoration, including mural painting. While architectural developments in Rome, Pompeii, and Central Italy are highlighted, the course also provides a survey of sites and structures in what are now North Italy, Sicily, France, Spain, Germany, Greece, Turkey, Croatia, Jordan, Lebanon, Libya, and North Africa. The lectures are illustrated with over 1,500 images, many from Professor Kleiner’s personal collection.',
    archive: 'oyc_Roman_Architecture',
    host: 'yale',
    lectures: [
      {
        title: 'Introduction to Roman Architecture',
        page: '/history-art/hsar-252/lecture-1',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring09/hsar252/mp3/hsar252_01_011309.mp3',
        durationMs: 2550910,
      },
      {
        title: 'It Takes a City: The Founding of Rome and the Beginnings of Urbanism in Italy',
        page: '/history-art/hsar-252/lecture-2',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring09/hsar252/mp3/hsar252_02_011509.mp3',
        durationMs: 4466710,
      },
      {
        title: 'Technology and Revolution in Roman Architecture',
        page: '/history-art/hsar-252/lecture-3',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring09/hsar252/mp3/hsar252_03_012009.mp3',
        durationMs: 4248480,
      },
      {
        title: 'Civic Life Interrupted: Nightmare and Destiny on August 24, A.D. 79',
        page: '/history-art/hsar-252/lecture-4',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring09/hsar252/mp3/hsar252_04_012209.mp3',
        durationMs: 4308200,
      },
      {
        title: 'Lifestyles of the Rich and Famous: Houses and Villas at Pompeii',
        page: '/history-art/hsar-252/lecture-5',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring09/hsar252/mp3/hsar252_05_012709.mp3',
        durationMs: 4530340,
      },
      {
        title: 'Habitats at Herculaneum and Early Roman Interior Decoration',
        page: '/history-art/hsar-252/lecture-6',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring09/hsar252/mp3/hsar252_06_012909.mp3',
        durationMs: 4363550,
      },
      {
        title: 'Gilding the Lily: Painting Palaces and Villas in the First Century A.D.',
        page: '/history-art/hsar-252/lecture-7',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring09/hsar252/mp3/hsar252_07_020309.mp3',
        durationMs: 4437240,
      },
      {
        title: 'Exploring Special Subjects on Pompeian Walls',
        page: '/history-art/hsar-252/lecture-8',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring09/hsar252/mp3/hsar252_08_020509.mp3',
        durationMs: 4027960,
      },
      {
        title: 'From Brick to Marble: Augustus Assembles Rome',
        page: '/history-art/hsar-252/lecture-9',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring09/hsar252/mp3/hsar252_09_021009.mp3',
        durationMs: 4502520,
      },
      {
        title: 'Accessing Afterlife: Tombs of Roman Aristocrats, Freedmen, and Slaves',
        page: '/history-art/hsar-252/lecture-10',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring09/hsar252/mp3/hsar252_10_021209.mp3',
        durationMs: 4317000,
      },
      {
        title: 'Notorious Nero and His Amazing Architectural Legacy',
        page: '/history-art/hsar-252/lecture-11',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring09/hsar252/mp3/hsar252_11_021709.mp3',
        durationMs: 4429770,
      },
      {
        title: 'The Creation of an Icon: The Colosseum and Contemporary Architecture in Rome',
        page: '/history-art/hsar-252/lecture-12',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring09/hsar252/mp3/hsar252_12_021909.mp3',
        durationMs: 4333950,
      },
      {
        title: 'The Prince and the Palace: Human Made Divine on the Palatine Hill',
        page: '/history-art/hsar-252/lecture-13',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring09/hsar252/mp3/hsar252_13_022409.mp3',
        durationMs: 4426950,
      },
      {
        title: 'Paper Topics: Discovering the Roman Provinces and Designing a Roman City',
        page: '/history-art/hsar-252/paper-topics',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring09/hsar252/mp3/hsar252_papertopics_030309.mp3',
        durationMs: 4064740,
      },
      {
        title: 'The Mother of All Forums: Civic Architecture in Rome under Trajan',
        page: '/history-art/hsar-252/lecture-14',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring09/hsar252/mp3/hsar252_14_030509.mp3',
        durationMs: 4292970,
      },
      {
        title: 'Rome and a Villa: Hadrian’s Pantheon and Tivoli Retreat',
        page: '/history-art/hsar-252/lecture-15',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring09/hsar252/mp3/hsar252_15_032409.mp3',
        durationMs: 4404670,
      },
      {
        title: 'The Roman Way of Life and Death at Ostia, the Port of Rome',
        page: '/history-art/hsar-252/lecture-16',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring09/hsar252/mp3/hsar252_16_032609.mp3',
        durationMs: 4568670,
      },
      {
        title:
          'Bigger Is Better: The Baths of Caracalla and Other Second- and Third-Century Buildings in Rome',
        page: '/history-art/hsar-252/lecture-17',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring09/hsar252/mp3/hsar252_17_033109.mp3',
        durationMs: 4536560,
      },
      {
        title: 'Hometown Boy: Honoring an Emperor’s Roots in Roman North Africa',
        page: '/history-art/hsar-252/lecture-18',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring09/hsar252/mp3/hsar252_18_040209.mp3',
        durationMs: 4378680,
      },
      {
        title:
          'Baroque Extravaganzas: Rock Tombs, Fountains, and Sanctuaries in Jordan, Lebanon, and Libya',
        page: '/history-art/hsar-252/lecture-19',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring09/hsar252/mp3/hsar252_19_040709.mp3',
        durationMs: 4374240,
      },
      {
        title: 'Roman Wine in Greek Bottles: The Rebirth of Athens',
        page: '/history-art/hsar-252/lecture-20',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring09/hsar252/mp3/hsar252_20_040909.mp3',
        durationMs: 4562400,
      },
      {
        title: 'Making Mini Romes on the Western Frontier',
        page: '/history-art/hsar-252/lecture-21',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring09/hsar252/mp3/hsar252_21_041409.mp3',
        durationMs: 4454460,
      },
      {
        title: 'Rome Redux: The Tetrarchic Renaissance',
        page: '/history-art/hsar-252/lecture-22',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring09/hsar252/mp3/hsar252_22_041609.mp3',
        durationMs: 4421600,
      },
      {
        title: 'Rome of Constantine and a New Rome',
        page: '/history-art/hsar-252/lecture-23',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring09/hsar252/mp3/hsar252_23_042109.mp3',
        durationMs: 4533740,
      },
    ],
  },
  {
    id: 'ital-310',
    code: 'ITAL 310',
    title: 'Dante in Translation',
    lecturer: 'Giuseppe Mazzotta',
    term: 'Fall 2008',
    department: 'Italian Language and Literature',
    page: '/italian-language-and-literature/ital-310',
    description:
      'The course is an introduction to Dante and his cultural milieu through a critical reading of the Divine Comedy and selected minor works (Vita nuova, Convivio, De vulgari eloquentia, Epistle to Cangrande). An analysis of Dante’s autobiography, the Vita nuova, establishes the poetic and political circumstances of the Comedy’s composition. Readings of Inferno, Purgatory and Paradise seek to situate Dante’s work within the intellectual and social context of the late Middle Ages, with special attention paid to political, philosophical and theological concerns. Topics in the Divine Comedy explored over the course of the semester include the relationship between ethics and aesthetics; love and knowledge; and exile and history.',
    archive: 'oyc_Dante_in_Translation',
    host: 'yale',
    lectures: [
      {
        title: 'Introduction',
        page: '/italian-language-and-literature/ital-310/lecture-1',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall08/ital310/mp3/ital310_01_090408.mp3',
        durationMs: 1125360,
      },
      {
        title: 'Vita Nuova',
        page: '/italian-language-and-literature/ital-310/lecture-2',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall08/ital310/mp3/ital310_02_090908.mp3',
        durationMs: 4150600,
      },
      {
        title: 'Inferno I, II, III, IV',
        page: '/italian-language-and-literature/ital-310/lecture-3',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall08/ital310/mp3/ital310_03_091108.mp3',
        durationMs: 4506570,
      },
      {
        title: 'Inferno V, VI, VII',
        page: '/italian-language-and-literature/ital-310/lecture-4',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall08/ital310/mp3/ital310_04_091608.mp3',
        durationMs: 4263870,
      },
      {
        title: 'Inferno IX, X, XI',
        page: '/italian-language-and-literature/ital-310/lecture-5',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall08/ital310/mp3/ital310_05_091808.mp3',
        durationMs: 4662910,
      },
      {
        title: 'Inferno XII, XIII, XV, XVI',
        page: '/italian-language-and-literature/ital-310/lecture-6',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall08/ital310/mp3/ital310_06_092308.mp3',
        durationMs: 4483980,
      },
      {
        title: 'Inferno XIX, XXI, XXV, XXVI',
        page: '/italian-language-and-literature/ital-310/lecture-7',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall08/ital310/mp3/ital310_07_092508.mp3',
        durationMs: 4275360,
      },
      {
        title: 'Inferno XXVI, XXVII, XXVIII',
        page: '/italian-language-and-literature/ital-310/lecture-8',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall08/ital310/mp3/ital310_08_093008.mp3',
        durationMs: 4074580,
      },
      {
        title: 'Inferno XXX, XXXI, XXXII, XXXIII, XXXIV',
        page: '/italian-language-and-literature/ital-310/lecture-9',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall08/ital310/mp3/ital310_09_100208.mp3',
        durationMs: 4609080,
      },
      {
        title: 'Purgatory I, II',
        page: '/italian-language-and-literature/ital-310/lecture-10',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall08/ital310/mp3/ital310_10_100708.mp3',
        durationMs: 4258490,
      },
      {
        title: 'Purgatory V, VI, IX, X',
        page: '/italian-language-and-literature/ital-310/lecture-11',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall08/ital310/mp3/ital310_11_100908.mp3',
        durationMs: 4625300,
      },
      {
        title: 'Purgatory X, XI, XII, XVI, XVII',
        page: '/italian-language-and-literature/ital-310/lecture-12',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall08/ital310/mp3/ital310_12_101408.mp3',
        durationMs: 4301120,
      },
      {
        title: 'Purgatory XIX, XXI, XXII',
        page: '/italian-language-and-literature/ital-310/lecture-13',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall08/ital310/mp3/ital310_13_101608.mp3',
        durationMs: 4744050,
      },
      {
        title: 'Purgatory XXIV, XXV, XXVI',
        page: '/italian-language-and-literature/ital-310/lecture-14',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall08/ital310/mp3/ital310_14_102308.mp3',
        durationMs: 3200290,
      },
      {
        title: 'Purgatory XXX, XXXI, XXXIII',
        page: '/italian-language-and-literature/ital-310/lecture-15',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall08/ital310/mp3/ital310_15_102808.mp3',
        durationMs: 4120870,
      },
      {
        title: 'Paradise I, II',
        page: '/italian-language-and-literature/ital-310/lecture-16',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall08/ital310/mp3/ital310_16_103008.mp3',
        durationMs: 4509630,
      },
      {
        title: 'Paradise IV, VI, X',
        page: '/italian-language-and-literature/ital-310/lecture-17',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall08/ital310/mp3/ital310_17_110408.mp3',
        durationMs: 4548890,
      },
      {
        title: 'Paradise XI, XII',
        page: '/italian-language-and-literature/ital-310/lecture-18',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall08/ital310/mp3/ital310_18_110608.mp3',
        durationMs: 4391290,
      },
      {
        title: 'Paradise XV, XVI, XVII',
        page: '/italian-language-and-literature/ital-310/lecture-19',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall08/ital310/mp3/ital310_19_111108.mp3',
        durationMs: 4269090,
      },
      {
        title: 'Paradise XVIII, XIX, XXI, XXI',
        page: '/italian-language-and-literature/ital-310/lecture-20',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall08/ital310/mp3/ital310_20_111308.mp3',
        durationMs: 4539230,
      },
      {
        title: 'Paradise XXIV, XXV, XXVI',
        page: '/italian-language-and-literature/ital-310/lecture-21',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall08/ital310/mp3/ital310_21_111808.mp3',
        durationMs: 4575560,
      },
      {
        title: 'Paradise XXVII, XXVIII, XXIX',
        page: '/italian-language-and-literature/ital-310/lecture-22',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall08/ital310/mp3/ital310_22_112008.mp3',
        durationMs: 4450750,
      },
      {
        title: 'Paradise XXX, XXXI, XXXII, XXXIII',
        page: '/italian-language-and-literature/ital-310/lecture-23',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall08/ital310/mp3/ital310_23_120208.mp3',
        durationMs: 4083150,
      },
      {
        title: 'General Review',
        page: '/italian-language-and-literature/ital-310/lecture-24',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall08/ital310/mp3/ital310_24_120408.mp3',
        durationMs: 4428490,
      },
    ],
  },
  {
    id: 'mcdb-150',
    code: 'MCDB 150',
    title: 'Global Problems of Population Growth',
    lecturer: 'Robert Wyman',
    term: 'Spring 2009',
    department: 'Molecular, Cellular and Developmental Biology',
    page: '/molecular-cellular-and-developmental-biology/mcdb-150',
    description:
      'This survey course introduces students to the important and basic material on human fertility, population growth, the demographic transition and population policy. Topics include: the human and environmental dimensions of population pressure, demographic history, economic and cultural causes of demographic change, environmental carrying capacity and sustainability. Political, religious and ethical issues surrounding fertility are also addressed. The lectures and readings attempt to balance theoretical and demographic scale analyzes with studies of individual humans and communities. The perspective is global with both developed and developing countries included.',
    archive: 'oyc_Global_Problems_of_Population_Growth',
    host: 'archive',
    lectures: [
      {
        title: 'Evolution of Sex and Reproductive Strategies',
        page: '/molecular-cellular-and-developmental-biology/mcdb-150/lecture-1',
        audio:
          'https://archive.org/download/oyc_Global_Problems_of_Population_Growth/01%20-%20Evolution%20of%20Sex%20and%20Reproductive%20Strategies.mp3',
        durationMs: 3988850,
      },
      {
        title: 'Sex and Violence Among the Apes',
        page: '/molecular-cellular-and-developmental-biology/mcdb-150/lecture-2',
        audio:
          'https://archive.org/download/oyc_Global_Problems_of_Population_Growth/02%20-%20Sex%20and%20Violence%20Among%20the%20Apes.mp3',
        durationMs: 4373710,
      },
      {
        title: 'From Ape to Human',
        page: '/molecular-cellular-and-developmental-biology/mcdb-150/lecture-3',
        audio:
          'https://archive.org/download/oyc_Global_Problems_of_Population_Growth/03%20-%20From%20Ape%20to%20Human.mp3',
        durationMs: 4403570,
      },
      {
        title: 'When Humans Were Scarce',
        page: '/molecular-cellular-and-developmental-biology/mcdb-150/lecture-4',
        audio:
          'https://archive.org/download/oyc_Global_Problems_of_Population_Growth/04%20-%20When%20Humans%20Were%20Scarce.mp3',
        durationMs: 4111600,
      },
      {
        title: 'Why Is Africa Different?',
        page: '/molecular-cellular-and-developmental-biology/mcdb-150/lecture-5',
        audio:
          'https://archive.org/download/oyc_Global_Problems_of_Population_Growth/05%20-%20Why%20Is%20Africa%20Different_.mp3',
        durationMs: 4278520,
      },
      {
        title: 'Malthusian Times',
        page: '/molecular-cellular-and-developmental-biology/mcdb-150/lecture-6',
        audio:
          'https://archive.org/download/oyc_Global_Problems_of_Population_Growth/06%20-%20Malthusian%20Times.mp3',
        durationMs: 4401560,
      },
      {
        title: 'Demographic Transition in Europe; Mortality Decline',
        page: '/molecular-cellular-and-developmental-biology/mcdb-150/lecture-7',
        audio:
          'https://archive.org/download/oyc_Global_Problems_of_Population_Growth/07%20-%20Demographic%20Transition%20in%20Europe%3B%20Mortality%20Decline.mp3',
        durationMs: 4134200,
      },
      {
        title: 'Demographic Transition in Europe; Fertility Decline',
        page: '/molecular-cellular-and-developmental-biology/mcdb-150/lecture-8',
        audio:
          'https://archive.org/download/oyc_Global_Problems_of_Population_Growth/08%20-%20Demographic%20Transition%20in%20Europe%3B%20Fertility%20Decline.mp3',
        durationMs: 4295010,
      },
      {
        title: 'Demographic Transition in Europe',
        page: '/molecular-cellular-and-developmental-biology/mcdb-150/lecture-9',
        audio:
          'https://archive.org/download/oyc_Global_Problems_of_Population_Growth/09%20-%20Demographic%20Transition%20in%20Europe.mp3',
        durationMs: 3987130,
      },
      {
        title: 'Quantitative Aspects',
        page: '/molecular-cellular-and-developmental-biology/mcdb-150/lecture-10',
        audio:
          'https://archive.org/download/oyc_Global_Problems_of_Population_Growth/10%20-%20Quantitative%20Aspects.mp3',
        durationMs: 3741580,
      },
      {
        title: 'Low Fertility in Developed Countries (Guest Lecture by Michael Teitelbaum)',
        page: '/molecular-cellular-and-developmental-biology/mcdb-150/lecture-11',
        audio:
          'https://archive.org/download/oyc_Global_Problems_of_Population_Growth/11%20-%20%20Low%20Fertility%20in%20Developed%20Countries%20(Guest%20Lecture%20by%20Michael%20Teitelbaum).mp3',
        durationMs: 4331710,
      },
      {
        title: 'Human and Environmental Impacts',
        page: '/molecular-cellular-and-developmental-biology/mcdb-150/lecture-12',
        audio:
          'https://archive.org/download/oyc_Global_Problems_of_Population_Growth/12%20-%20Human%20and%20Environmental%20Impacts.mp3',
        durationMs: 4271180,
      },
      {
        title: 'Fertility Attitudes and Practices',
        page: '/molecular-cellular-and-developmental-biology/mcdb-150/lecture-13',
        audio:
          'https://archive.org/download/oyc_Global_Problems_of_Population_Growth/13%20-%20Fertility%20Attitudes%20and%20Practices.mp3',
        durationMs: 1773200,
      },
      {
        title: 'Demographic Transition in Developing Countries',
        page: '/molecular-cellular-and-developmental-biology/mcdb-150/lecture-14',
        audio:
          'https://archive.org/download/oyc_Global_Problems_of_Population_Growth/14%20-%20Demographic%20Transition%20in%20Developing%20Countries.mp3',
        durationMs: 4235580,
      },
      {
        title: 'Female Disadvantage',
        page: '/molecular-cellular-and-developmental-biology/mcdb-150/lecture-15',
        audio:
          'https://archive.org/download/oyc_Global_Problems_of_Population_Growth/15%20-%20Female%20Disadvantage.mp3',
        durationMs: 4461800,
      },
      {
        title: 'Population in Traditional China',
        page: '/molecular-cellular-and-developmental-biology/mcdb-150/lecture-16',
        audio:
          'https://archive.org/download/oyc_Global_Problems_of_Population_Growth/16%20-%20Population%20in%20Traditional%20China.mp3',
        durationMs: 2159420,
      },
      {
        title: 'Population in Modern China',
        page: '/molecular-cellular-and-developmental-biology/mcdb-150/lecture-17',
        audio:
          'https://archive.org/download/oyc_Global_Problems_of_Population_Growth/17%20-%20Population%20in%20Modern%20China.mp3',
        durationMs: 3948570,
      },
      {
        title: 'Economic Impact of Population Growth',
        page: '/molecular-cellular-and-developmental-biology/mcdb-150/lecture-18',
        audio:
          'https://archive.org/download/oyc_Global_Problems_of_Population_Growth/18%20-%20Economic%20Impact%20of%20Population%20Growth.mp3',
        durationMs: 4286650,
      },
      {
        title: 'Economic Motivations for Fertility',
        page: '/molecular-cellular-and-developmental-biology/mcdb-150/lecture-19',
        audio:
          'https://archive.org/download/oyc_Global_Problems_of_Population_Growth/19%20-%20Economic%20Motivations%20for%20Fertility.mp3',
        durationMs: 4441610,
      },
      {
        title: 'Teen Sexuality and Teen Pregnancy',
        page: '/molecular-cellular-and-developmental-biology/mcdb-150/lecture-20',
        audio:
          'https://archive.org/download/oyc_Global_Problems_of_Population_Growth/20%20-%20Teen%20Sexuality%20and%20Teen%20Pregnancy.mp3',
        durationMs: 4485520,
      },
      {
        title: 'Global Demography of Abortion',
        page: '/molecular-cellular-and-developmental-biology/mcdb-150/lecture-21',
        audio:
          'https://archive.org/download/oyc_Global_Problems_of_Population_Growth/21%20-%20Global%20Demography%20of%20Abortion.mp3',
        durationMs: 4319740,
      },
      {
        title:
          'Media and the Fertility Transition in Developing Countries (Guest Lecture by William Ryerson)',
        page: '/molecular-cellular-and-developmental-biology/mcdb-150/lecture-22',
        audio:
          'https://archive.org/download/oyc_Global_Problems_of_Population_Growth/22%20-%20Media%20and%20the%20Fertility%20Transition%20in%20Developing%20Countries%20(Guest%20Lecture%20by%20William%20Ryerson).mp3',
        durationMs: 4602340,
      },
      {
        title: 'Biology and History of Abortion',
        page: '/molecular-cellular-and-developmental-biology/mcdb-150/lecture-23',
        audio:
          'https://archive.org/download/oyc_Global_Problems_of_Population_Growth/23%20-%20Biology%20and%20History%20of%20Abortion.mp3',
        durationMs: 4416790,
      },
      {
        title: 'Population and the Environment',
        page: '/molecular-cellular-and-developmental-biology/mcdb-150/lecture-24',
        audio:
          'https://archive.org/download/oyc_Global_Problems_of_Population_Growth/24%20-%20Population%20and%20the%20Environment.mp3',
        durationMs: 4508140,
      },
    ],
  },
  {
    id: 'phil-181',
    code: 'PHIL 181',
    title: 'Philosophy and the Science of Human Nature',
    lecturer: 'Tamar Gendler',
    term: 'Spring 2011',
    department: 'Philosophy',
    page: '/philosophy/phil-181',
    description:
      'Philosophy and the Science of Human Nature pairs central texts from Western philosophical tradition (including works by Plato, Aristotle, Epictetus, Hobbes, Kant, Mill, Rawls, and Nozick) with recent findings in cognitive science and related fields. The course is structured around three intertwined sets of topics: Happiness and Flourishing; Morality and Justice; and Political Legitimacy and Social Structures.',
    archive: 'oyc_Philosophy_and_the_Science_of_Human_Nature',
    host: 'yale',
    lectures: [
      {
        title: 'Introduction',
        page: '/philosophy/phil-181/lecture-1',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring11/phil181/mp3/phil181_01_011111.mp3',
        durationMs: 2570850,
      },
      {
        title: 'The Ring of Gyges: Morality and Hypocrisy',
        page: '/philosophy/phil-181/lecture-2',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring11/phil181/mp3/phil181_02_011311.mp3',
        durationMs: 2549950,
      },
      {
        title: 'Parts of the Soul I',
        page: '/philosophy/phil-181/lecture-3',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring11/phil181/mp3/phil181_03_011811.mp3',
        durationMs: 2704330,
      },
      {
        title: 'Parts of the Soul II',
        page: '/philosophy/phil-181/lecture-4',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring11/phil181/mp3/phil181_04_012011.mp3',
        durationMs: 2704750,
      },
      {
        title: 'The Well-Ordered Soul: Happiness and Harmony',
        page: '/philosophy/phil-181/lecture-5',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring11/phil181/mp3/phil181_05_012511.mp3',
        durationMs: 2665540,
      },
      {
        title: 'The Disordered Soul: Thémis and PTSD',
        page: '/philosophy/phil-181/lecture-6',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring11/phil181/mp3/phil181_06_020111.mp3',
        durationMs: 2638030,
      },
      {
        title: 'Flourishing and Attachment',
        page: '/philosophy/phil-181/lecture-7',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring11/phil181/mp3/phil181_07_020311.mp3',
        durationMs: 2265840,
      },
      {
        title: 'Flourishing and Detachment',
        page: '/philosophy/phil-181/lecture-8',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring11/phil181/mp3/phil181_08_020311.mp3',
        durationMs: 2608650,
      },
      {
        title: 'Virtue and Habit I',
        page: '/philosophy/phil-181/lecture-9',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring11/phil181/mp3/phil181_09_020811.mp3',
        durationMs: 2410090,
      },
      {
        title: 'Virtue and Habit II',
        page: '/philosophy/phil-181/lecture-10',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring11/phil181/mp3/phil181_10_021011.mp3',
        durationMs: 2678470,
      },
      {
        title: 'Weakness of the Will and Procrastination',
        page: '/philosophy/phil-181/lecture-11',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring11/phil181/mp3/phil181_11_021511.mp3',
        durationMs: 2699810,
      },
      {
        title: 'Utilitarianism and its Critiques',
        page: '/philosophy/phil-181/lecture-12',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring11/phil181/mp3/phil181_12_021711.mp3',
        durationMs: 2839020,
      },
      {
        title: 'Deontology',
        page: '/philosophy/phil-181/lecture-13',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring11/phil181/mp3/phil181_13_022211.mp3',
        durationMs: 2772770,
      },
      {
        title: 'The Trolley Problem',
        page: '/philosophy/phil-181/lecture-14',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring11/phil181/mp3/phil181_14_022411.mp3',
        durationMs: 2914770,
      },
      {
        title: 'Empirically-informed Responses',
        page: '/philosophy/phil-181/lecture-15',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring11/phil181/mp3/phil181_15_030111.mp3',
        durationMs: 2978380,
      },
      {
        title: 'Philosophical Puzzles',
        page: '/philosophy/phil-181/lecture-16',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring11/phil181/mp3/phil181_16_030311.mp3',
        durationMs: 2848740,
      },
      {
        title: 'Punishment I',
        page: '/philosophy/phil-181/lecture-17',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring11/phil181/mp3/phil181_17_032211.mp3',
        durationMs: 2677500,
      },
      {
        title: 'Punishment II',
        page: '/philosophy/phil-181/lecture-18',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring11/phil181/mp3/phil181_18_032411.mp3',
        durationMs: 2912550,
      },
      {
        title: 'Contract & Commonwealth: Thomas Hobbes',
        page: '/philosophy/phil-181/lecture-19',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring11/phil181/mp3/phil181_19_032911.mp3',
        durationMs: 2787480,
      },
      {
        title: 'The Prisoner’s Dilemma',
        page: '/philosophy/phil-181/lecture-20',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring11/phil181/mp3/phil181_20_033111.mp3',
        durationMs: 2834580,
      },
      {
        title: 'Equality',
        page: '/philosophy/phil-181/lecture-21',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring11/phil181/mp3/phil181_21_040511.mp3',
        durationMs: 2752890,
      },
      {
        title: 'Equality II',
        page: '/philosophy/phil-181/lecture-22',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring11/phil181/mp3/phil181_22_040711.mp3',
        durationMs: 2742600,
      },
      {
        title: 'Social Structures',
        page: '/philosophy/phil-181/lecture-23',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring11/phil181/mp3/phil181_23_041211.mp3',
        durationMs: 2957220,
      },
      {
        title: 'Censorship',
        page: '/philosophy/phil-181/lecture-24',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring11/phil181/mp3/phil181_24_041411.mp3',
        durationMs: 2721130,
      },
      {
        title: 'Tying up Loose Ends',
        page: '/philosophy/phil-181/lecture-25',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring11/phil181/mp3/phil181_25_041911.mp3',
        durationMs: 2654490,
      },
      {
        title: 'Concluding Lecture',
        page: '/philosophy/phil-181/lecture-26',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring11/phil181/mp3/phil181_26_042111.mp3',
        durationMs: 2905840,
      },
    ],
  },
  {
    id: 'phil-176',
    code: 'PHIL 176',
    title: 'Death',
    lecturer: 'Shelly Kagan',
    term: 'Spring 2007',
    department: 'Philosophy',
    page: '/death/phil-176',
    description:
      'There is one thing I can be sure of: I am going to die. But what am I to make of that fact? This course will examine a number of issues that arise once we begin to reflect on our mortality. The possibility that death may not actually be the end is considered. Are we, in some sense, immortal? Would immortality be desirable? Also a clearer notion of what it is to die is examined. What does it mean to say that a person has died? What kind of fact is that? And, finally, different attitudes to death are evaluated. Is death an evil? How? Why? Is suicide morally permissible? Is it rational? How should the knowledge that I am going to die affect the way I live my life?',
    archive: 'oyc_Death',
    host: 'archive',
    lectures: [
      {
        title: 'Course Introduction',
        page: '/philosophy/phil-176/lecture-1',
        audio: 'https://archive.org/download/oyc_Death/01%20-%20Course%20introduction.mp3',
        durationMs: 2763260,
      },
      {
        title: 'The Nature of Persons: Dualism vs. Physicalism',
        page: '/philosophy/phil-176/lecture-2',
        audio:
          'https://archive.org/download/oyc_Death/02%20-%20The%20nature%20of%20persons_%20dualism%20vs.%20physicalism.mp3',
        durationMs: 2497960,
      },
      {
        title: 'Arguments for the Existence of the Soul, Part I',
        page: '/philosophy/phil-176/lecture-3',
        audio:
          'https://archive.org/download/oyc_Death/03%20-%20Arguments%20for%20the%20existence%20of%20the%20soul%2C%20Part%20I.mp3',
        durationMs: 2747750,
      },
      {
        title: 'Introduction to Plato’s Phaedo; Arguments for the Existence of the Soul, Part II',
        page: '/philosophy/phil-176/lecture-4',
        audio:
          "https://archive.org/download/oyc_Death/04%20-%20Introduction%20to%20Plato's%20Phaedo%3B%20Arguments%20for%20the%20existence%20of%20the%20soul%2C%20Part%20II.mp3",
        durationMs: 2943740,
      },
      {
        title:
          'Arguments for the Existence of the Soul, Part III: Free Will and Near-Death Experiences',
        page: '/philosophy/phil-176/lecture-5',
        audio:
          'https://archive.org/download/oyc_Death/05%20-%20Arguments%20for%20the%20existence%20of%20the%20soul%2C%20Part%20III_%20Free%20will%20and%20near-death%20experiences.mp3',
        durationMs: 2882150,
      },
      {
        title: 'Arguments for the Existence of the Soul, Part IV; Plato, Part I',
        page: '/philosophy/phil-176/lecture-6',
        audio:
          'https://archive.org/download/oyc_Death/06%20-%20Arguments%20for%20the%20existence%20of%20the%20soul%2C%20Part%20IV%3B%20Plato%2C%20Part%20I.mp3',
        durationMs: 2142020,
      },
      {
        title: 'Plato, Part II: Arguments for the Immortality of the Soul',
        page: '/philosophy/phil-176/lecture-7',
        audio:
          'https://archive.org/download/oyc_Death/07%20-%20Plato%2C%20Part%20II_%20Arguments%20for%20the%20immortality%20of%20the%20soul.mp3',
        durationMs: 2797720,
      },
      {
        title: 'Plato, Part III: Arguments for the Immortality of the Soul (cont.)',
        page: '/philosophy/phil-176/lecture-8',
        audio:
          'https://archive.org/download/oyc_Death/08%20-%20Plato%2C%20Part%20III_%20Arguments%20for%20the%20immortality%20of%20the%20soul%20(cont.).mp3',
        durationMs: 2994160,
      },
      {
        title: 'Plato, Part IV: Arguments for the Immortality of the Soul (cont.)',
        page: '/philosophy/phil-176/lecture-9',
        audio:
          'https://archive.org/download/oyc_Death/09%20-%20Plato%2C%20Part%20IV_%20Arguments%20for%20the%20immortality%20of%20the%20soul%20(cont.).mp3',
        durationMs: 3020180,
      },
      {
        title: 'Personal Identity, Part I: Identity Across Space and Time and the Soul Theory',
        page: '/philosophy/phil-176/lecture-10',
        audio:
          'https://archive.org/download/oyc_Death/10%20-%20Personal%20identity%2C%20Part%20I_%20Identity%20across%20space%20and%20time%20and%20the%20soul%20theory.mp3',
        durationMs: 2989800,
      },
      {
        title: 'Personal Identity, Part II: The Body Theory and the Personality Theory',
        page: '/philosophy/phil-176/lecture-11',
        audio:
          'https://archive.org/download/oyc_Death/11%20-%20Personal%20identity%2C%20Part%20II_%20The%20body%20theory%20and%20the%20personality%20theory.mp3',
        durationMs: 3034570,
      },
      {
        title: 'Personal Identity, Part III: Objections to the Personality Theory',
        page: '/philosophy/phil-176/lecture-12',
        audio:
          'https://archive.org/download/oyc_Death/12%20-%20Personal%20identity%2C%20Part%20III_%20Objections%20to%20the%20personality%20theory.mp3',
        durationMs: 3110540,
      },
      {
        title: 'Personal Identity, Part IV: What Matters?',
        page: '/philosophy/phil-176/lecture-13',
        audio:
          'https://archive.org/download/oyc_Death/13%20-%20Personal%20identity%2C%20Part%20IV%3B%20What%20matters_.mp3',
        durationMs: 2932690,
      },
      {
        title: 'What Matters (cont.); The Nature of Death, Part I',
        page: '/philosophy/phil-176/lecture-14',
        audio:
          'https://archive.org/download/oyc_Death/14%20-%20What%20matters%20(cont.)%3B%20The%20nature%20of%20death%2C%20Part%20I.mp3',
        durationMs: 2837970,
      },
      {
        title: 'The Nature of Death (cont.); Believing You Will Die',
        page: '/philosophy/phil-176/lecture-15',
        audio:
          'https://archive.org/download/oyc_Death/15%20-%20The%20nature%20of%20death%20(cont.)%3B%20Believing%20you%20will%20die.mp3',
        durationMs: 2654990,
      },
      {
        title: 'Dying Alone; The Badness of Death, Part I',
        page: '/philosophy/phil-176/lecture-16',
        audio:
          'https://archive.org/download/oyc_Death/16%20-%20Dying%20alone%3B%20The%20badness%20of%20death%2C%20Part%20I.mp3',
        durationMs: 2990630,
      },
      {
        title: 'The Badness of Death, Part II: The Deprivation Account',
        page: '/philosophy/phil-176/lecture-17',
        audio:
          'https://archive.org/download/oyc_Death/17%20-%20The%20badness%20of%20death%2C%20Part%20II_%20The%20deprivation%20account.mp3',
        durationMs: 3096270,
      },
      {
        title: 'The Badness of Death, Part III; Immortality, Part I',
        page: '/philosophy/phil-176/lecture-18',
        audio:
          'https://archive.org/download/oyc_Death/18%20-%20The%20badness%20of%20death%2C%20Part%20III%3B%20Immortality%2C%20Part%20I.mp3',
        durationMs: 3034230,
      },
      {
        title: 'Immortality Part II; The Value of Life, Part I',
        page: '/philosophy/phil-176/lecture-19',
        audio:
          'https://archive.org/download/oyc_Death/19%20-%20Immortality%20Part%20II%3B%20The%20value%20of%20life%2C%20Part%20I.mp3',
        durationMs: 2940840,
      },
      {
        title: 'The Value of Life, Part II; Other Bad Aspects of Death, Part I',
        page: '/philosophy/phil-176/lecture-20',
        audio:
          'https://archive.org/download/oyc_Death/20%20-%20The%20value%20of%20life%2C%20Part%20II%3B%20Other%20bad%20aspects%20of%20death%2C%20Part%20I.mp3',
        durationMs: 3039430,
      },
      {
        title: 'Other Bad Aspects of Death, Part II',
        page: '/philosophy/phil-176/lecture-21',
        audio:
          'https://archive.org/download/oyc_Death/21%20-%20Other%20bad%20aspects%20of%20death%2C%20Part%20II.mp3',
        durationMs: 2986790,
      },
      {
        title: 'Fear of Death',
        page: '/philosophy/phil-176/lecture-22',
        audio: 'https://archive.org/download/oyc_Death/22%20-%20Fear%20of%20death.mp3',
        durationMs: 2869400,
      },
      {
        title: 'How to Live Given the Certainty of Death',
        page: '/philosophy/phil-176/lecture-23',
        audio:
          'https://archive.org/download/oyc_Death/23%20-%20How%20to%20live%20given%20the%20certainty%20of%20death.mp3',
        durationMs: 2794790,
      },
      {
        title: 'Suicide, Part I: The Rationality of Suicide',
        page: '/philosophy/phil-176/lecture-24',
        audio:
          'https://archive.org/download/oyc_Death/24%20-%20Suicide%2C%20Part%20I_%20The%20rationality%20of%20suicide.mp3',
        durationMs: 2718460,
      },
      {
        title: 'Suicide, Part II: Deciding under Uncertainty',
        page: '/philosophy/phil-176/lecture-25',
        audio:
          'https://archive.org/download/oyc_Death/25%20-%20Suicide%2C%20Part%20II_%20Deciding%20under%20uncertainty.mp3',
        durationMs: 3015370,
      },
      {
        title: 'Suicide, Part III: The Morality of Suicide and Course Conclusion',
        page: '/philosophy/phil-176/lecture-26',
        audio:
          'https://archive.org/download/oyc_Death/26%20-%20Suicide%2C%20Part%20III_%20The%20morality%20of%20suicide%20and%20course%20conclusion.mp3',
        durationMs: 2866470,
      },
    ],
  },
  {
    id: 'phys-200',
    code: 'PHYS 200',
    title: 'Fundamentals of Physics I',
    lecturer: 'Ramamurti Shankar',
    term: 'Fall 2006',
    department: 'Physics',
    page: '/physics/phys-200',
    description:
      'This course provides a thorough introduction to the principles and methods of physics for students who have good preparation in physics and mathematics. Emphasis is placed on problem solving and quantitative reasoning. This course covers Newtonian mechanics, special relativity, gravitation, thermodynamics, and waves.',
    archive: 'oyc_Fundamentals_of_Physics_I',
    host: 'archive',
    lectures: [
      {
        title: 'Course Introduction and Newtonian Mechanics',
        page: '/physics/phys-200/lecture-1',
        audio:
          'https://archive.org/download/oyc_Fundamentals_of_Physics_I/01%20-%20Course%20Introduction%20and%20Newtonian%20Mechanics.mp3',
        durationMs: 4401090,
      },
      {
        title: 'Vectors in Multiple Dimensions',
        page: '/physics/phys-200/lecture-2',
        audio:
          'https://archive.org/download/oyc_Fundamentals_of_Physics_I/02%20-%20Vectors%20in%20Multiple%20Dimensions.mp3',
        durationMs: 4008570,
      },
      {
        title: 'Newton’s Laws of Motion',
        page: '/physics/phys-200/lecture-3',
        audio:
          "https://archive.org/download/oyc_Fundamentals_of_Physics_I/03%20-%20Newton's%20Laws%20of%20Motion.mp3",
        durationMs: 4102040,
      },
      {
        title: 'Newton’s Laws (cont.) and Inclined Planes',
        page: '/physics/phys-200/lecture-4',
        audio:
          "https://archive.org/download/oyc_Fundamentals_of_Physics_I/04%20-%20Newton's%20Laws%20(cont'd)%20and%20Inclined%20Planes.mp3",
        durationMs: 4044880,
      },
      {
        title: 'Work-Energy Theorem and Law of Conservation of Energy',
        page: '/physics/phys-200/lecture-5',
        audio:
          'https://archive.org/download/oyc_Fundamentals_of_Physics_I/05%20-%20Work-Energy%20Theorem%20and%20Law%20of%20Conservation%20of%20Energy.mp3',
        durationMs: 4215780,
      },
      {
        title: 'Law of Conservation of Energy in Higher Dimensions',
        page: '/physics/phys-200/lecture-6',
        audio:
          'https://archive.org/download/oyc_Fundamentals_of_Physics_I/06%20-%20Law%20of%20Conservation%20of%20Energy%20in%20Higher%20Dimensions.mp3',
        durationMs: 4260890,
      },
      {
        title: 'Kepler’s Laws',
        page: '/physics/phys-200/lecture-7',
        audio:
          "https://archive.org/download/oyc_Fundamentals_of_Physics_I/07%20-%20Kepler's%20Laws.mp3",
        durationMs: 4330010,
      },
      {
        title: 'Dynamics of a Multiple-Body System and Law of Conservation of Momentum',
        page: '/physics/phys-200/lecture-8',
        audio:
          'https://archive.org/download/oyc_Fundamentals_of_Physics_I/08%20-%20Dynamics%20of%20Multiple-Body%20System%20and%20Law%20of%20Conservation%20of%20Momentum.mp3',
        durationMs: 4330010,
      },
      {
        title: 'Rotations, Part I: Dynamics of Rigid Bodies',
        page: '/physics/phys-200/lecture-9',
        audio:
          'https://archive.org/download/oyc_Fundamentals_of_Physics_I/09%20-%20Rotations_%20Part%20I%3B%20Dynamics%20of%20Rigid%20Bodies.mp3',
        durationMs: 4431030,
      },
      {
        title: 'Rotations, Part II: Parallel Axis Theorem',
        page: '/physics/phys-200/lecture-10',
        audio:
          'https://archive.org/download/oyc_Fundamentals_of_Physics_I/10%20-%20Rotations_%20Part%20II%3B%20Parallel%20Axis%20Theorem.mp3',
        durationMs: 4526900,
      },
      {
        title: 'Torque',
        page: '/physics/phys-200/lecture-11',
        audio: 'https://archive.org/download/oyc_Fundamentals_of_Physics_I/11%20-%20Torque.mp3',
        durationMs: 4393700,
      },
      {
        title: 'Introduction to Relativity',
        page: '/physics/phys-200/lecture-12',
        audio:
          'https://archive.org/download/oyc_Fundamentals_of_Physics_I/12%20-%20Introduction%20to%20Relativity.mp3',
        durationMs: 4281530,
      },
      {
        title: 'Lorentz Transformation',
        page: '/physics/phys-200/lecture-13',
        audio:
          'https://archive.org/download/oyc_Fundamentals_of_Physics_I/13%20-%20Lorentz%20Transformation.mp3',
        durationMs: 4107110,
      },
      {
        title: 'Introduction to the Four-Vector',
        page: '/physics/phys-200/lecture-14',
        audio:
          'https://archive.org/download/oyc_Fundamentals_of_Physics_I/14%20-%20Introduction%20to%20the%20Four-Vector.mp3',
        durationMs: 4354750,
      },
      {
        title: 'Four-Vector in Relativity',
        page: '/physics/phys-200/lecture-15',
        audio:
          'https://archive.org/download/oyc_Fundamentals_of_Physics_I/15%20-%20Four-Vector%20in%20Relativity.mp3',
        durationMs: 4303810,
      },
      {
        title: 'The Taylor Series and Other Mathematical Concepts',
        page: '/physics/phys-200/lecture-16',
        audio:
          'https://archive.org/download/oyc_Fundamentals_of_Physics_I/16%20-%20The%20Taylor%20Series%20and%20Other%20Mathematical%20Concepts.mp3',
        durationMs: 4419090,
      },
      {
        title: 'Simple Harmonic Motion',
        page: '/physics/phys-200/lecture-17',
        audio:
          'https://archive.org/download/oyc_Fundamentals_of_Physics_I/17%20-%20Simple%20Harmonic%20Motion.mp3',
        durationMs: 4439280,
      },
      {
        title: 'Simple Harmonic Motion (cont.) and Introduction to Waves',
        page: '/physics/phys-200/lecture-18',
        audio:
          "https://archive.org/download/oyc_Fundamentals_of_Physics_I/18%20-%20Simple%20Harmonic%20Motion%20(con't)%20and%20Introduction%20to%20Waves.mp3",
        durationMs: 4504170,
      },
      {
        title: 'Waves',
        page: '/physics/phys-200/lecture-19',
        audio: 'https://archive.org/download/oyc_Fundamentals_of_Physics_I/19%20-%20Waves.mp3',
        durationMs: 4313740,
      },
      {
        title: 'Fluid Dynamics and Statics and Bernoulli’s Equation',
        page: '/physics/phys-200/lecture-20',
        audio:
          "https://archive.org/download/oyc_Fundamentals_of_Physics_I/20%20-%20Fluid%20Dynamics%20and%20Statics%20and%20Bernoulli's%20Equation.mp3",
        durationMs: 4351610,
      },
      {
        title: 'Thermodynamics',
        page: '/physics/phys-200/lecture-21',
        audio:
          'https://archive.org/download/oyc_Fundamentals_of_Physics_I/21%20-%20Thermodynamics.mp3',
        durationMs: 4287740,
      },
      {
        title: 'The Boltzmann Constant and First Law of Thermodynamics',
        page: '/physics/phys-200/lecture-22',
        audio:
          'https://archive.org/download/oyc_Fundamentals_of_Physics_I/22%20-%20The%20Boltzmann%20Constant%20and%20First%20Law%20of%20Thermodynamics.mp3',
        durationMs: 4480210,
      },
      {
        title: 'The Second Law of Thermodynamics and Carnot’s Engine',
        page: '/physics/phys-200/lecture-23',
        audio:
          "https://archive.org/download/oyc_Fundamentals_of_Physics_I/23%20-%20The%20Second%20Law%20of%20Thermodynamics%20and%20Carnot's%20Engine.mp3",
        durationMs: 4269460,
      },
      {
        title: 'The Second Law of Thermodynamics (cont.) and Entropy',
        page: '/physics/phys-200/lecture-24',
        audio:
          "https://archive.org/download/oyc_Fundamentals_of_Physics_I/24%20-%20The%20Second%20Law%20of%20Thermodynamics%20(con't)%20and%20Entropy.mp3",
        durationMs: 4307550,
      },
    ],
  },
  {
    id: 'phys-201',
    code: 'PHYS 201',
    title: 'Fundamentals of Physics II',
    lecturer: 'Ramamurti Shankar',
    term: 'Spring 2010',
    department: 'Physics',
    page: '/physics/phys-201',
    description:
      'This is a continuation of Fundamentals of Physics, I (PHYS 200), the introductory course on the principles and methods of physics for students who have good preparation in physics and mathematics. This course covers electricity, magnetism, optics and quantum mechanics.',
    archive: 'oyc_Fundamentals_of_Physics_II',
    host: 'yale',
    lectures: [
      {
        title: 'Electrostatics',
        page: '/physics/phys-201/lecture-1',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring10/phys201/mp3/phys201_01_011110.mp3',
        durationMs: 3961680,
      },
      {
        title: 'Electric Fields',
        page: '/physics/phys-201/lecture-2',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring10/phys201/mp3/phys201_02_011310.mp3',
        durationMs: 4383010,
      },
      {
        title: 'Gauss’s Law I',
        page: '/physics/phys-201/lecture-3',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring10/phys201/mp3/phys201_03_011510.mp3',
        durationMs: 4279310,
      },
      {
        title: 'Gauss’s Law and Application to Conductors and Insulators',
        page: '/physics/phys-201/lecture-4',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring10/phys201/mp3/phys201_04_012010.mp3',
        durationMs: 4535410,
      },
      {
        title: 'The Electric Potential and Conservation of Energy',
        page: '/physics/phys-201/lecture-5',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring10/phys201/mp3/phys201_05_012510.mp3',
        durationMs: 4450700,
      },
      {
        title: 'Capacitors',
        page: '/physics/phys-201/lecture-6',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring10/phys201/mp3/phys201_06_012710.mp3',
        durationMs: 4362300,
      },
      {
        title: 'Resistance',
        page: '/physics/phys-201/lecture-7',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring10/phys201/mp3/phys201_07_020110.mp3',
        durationMs: 4458770,
      },
      {
        title: 'Circuits and Magnetism I',
        page: '/physics/phys-201/lecture-8',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring10/phys201/mp3/phys201_08_020310.mp3',
        durationMs: 4351250,
      },
      {
        title: 'Magnetism II',
        page: '/physics/phys-201/lecture-9',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring10/phys201/mp3/phys201_09_020810.mp3',
        durationMs: 4301280,
      },
      {
        title: 'Ampere’s Law',
        page: '/physics/phys-201/lecture-10',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring10/phys201/mp3/phys201_10_021010.mp3',
        durationMs: 4240460,
      },
      {
        title: 'Lenz’s and Faraday’s Laws',
        page: '/physics/phys-201/lecture-11',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring10/phys201/mp3/phys201_11_021510.mp3',
        durationMs: 4163400,
      },
      {
        title: 'LCR Circuits — DC Voltage',
        page: '/physics/phys-201/lecture-12',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring10/phys201/mp3/phys201_12_021710.mp3',
        durationMs: 4196660,
      },
      {
        title: 'LCR Circuits — AC Voltage',
        page: '/physics/phys-201/lecture-13',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring10/phys201/mp3/phys201_13_022210.mp3',
        durationMs: 4251380,
      },
      {
        title: 'Maxwell’s Equations and Electromagnetic Waves I',
        page: '/physics/phys-201/lecture-14',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring10/phys201/mp3/phys201_14_022410.mp3',
        durationMs: 4186360,
      },
      {
        title: 'Maxwell’s Equations and Electromagnetic Waves II',
        page: '/physics/phys-201/lecture-15',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring10/phys201/mp3/phys201_15_030310.mp3',
        durationMs: 4169280,
      },
      {
        title: 'Ray or Geometrical Optics I',
        page: '/physics/phys-201/lecture-16',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring10/phys201/mp3/phys201_16_032210.mp3',
        durationMs: 4400200,
      },
      {
        title: 'Ray or Geometrical Optics II',
        page: '/physics/phys-201/lecture-17',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring10/phys201/mp3/phys201_17_032410.mp3',
        durationMs: 4266400,
      },
      {
        title: 'Wave Theory of Light',
        page: '/physics/phys-201/lecture-18',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring10/phys201/mp3/phys201_18_032910.mp3',
        durationMs: 4484550,
      },
      {
        title: 'Quantum Mechanics I: Key Experiments and Wave-Particle Duality',
        page: '/physics/phys-201/lecture-19',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring10/phys201/mp3/phys201_19_033110.mp3',
        durationMs: 4428750,
      },
      {
        title: 'Quantum Mechanics II',
        page: '/physics/phys-201/lecture-20',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring10/phys201/mp3/phys201_20_040510.mp3',
        durationMs: 4548470,
      },
      {
        title: 'Quantum Mechanics III',
        page: '/physics/phys-201/lecture-21',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring10/phys201/mp3/phys201_21_040710.mp3',
        durationMs: 4546620,
      },
      {
        title: 'Quantum Mechanics IV: Measurement Theory, States of Definite Energy',
        page: '/physics/phys-201/lecture-22',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring10/phys201/mp3/phys201_22_041210.mp3',
        durationMs: 4540030,
      },
      {
        title: 'Quantum Mechanics V: Particle in a Box',
        page: '/physics/phys-201/lecture-23',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring10/phys201/mp3/phys201_23_041410.mp3',
        durationMs: 4137020,
      },
      {
        title: 'Quantum Mechanics VI: Time-Dependent Schrödinger Equation',
        page: '/physics/phys-201/lecture-24',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring10/phys201/mp3/phys201_24_041910.mp3',
        durationMs: 4458893,
      },
      {
        title: 'Quantum Mechanics VII: Summary of Postulates and Special Topics',
        page: '/physics/phys-201/lecture-25',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring10/phys201/mp3/phys201_25_042110.mp3',
        durationMs: 3223066,
      },
    ],
  },
  {
    id: 'plsc-114',
    code: 'PLSC 114',
    title: 'Introduction to Political Philosophy',
    lecturer: 'Steven B. Smith',
    term: 'Fall 2006',
    department: 'Political Science',
    page: '/political-science/plsc-114',
    description:
      'This course is intended as an introduction to political philosophy as seen through an examination of some of the major texts and thinkers of the Western political tradition. Three broad themes that are central to understanding political life are focused upon: the polis experience (Plato, Aristotle), the sovereign state (Machiavelli, Hobbes), constitutional government (Locke), and democracy (Rousseau, Tocqueville). The way in which different political philosophies have given expression to various forms of political institutions and our ways of life are examined throughout the course.',
    archive: 'oyc_Introduction_to_Political_Philosophy',
    host: 'yale',
    lectures: [
      {
        title: 'Introduction: What Is Political Philosophy?',
        page: '/political-science/plsc-114/lecture-1',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall06/plsc114/mp3/plsc114_01_091106.mp3',
        durationMs: 2225400,
      },
      {
        title: 'Socratic Citizenship: Plato, Apology',
        page: '/political-science/plsc-114/lecture-2',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall06/plsc114/mp3/plsc114_02_091306.mp3',
        durationMs: 2734900,
      },
      {
        title: 'Socratic Citizenship: Plato, Crito',
        page: '/political-science/plsc-114/lecture-3',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall06/plsc114/mp3/plsc114_03_091806.mp3',
        durationMs: 2835410,
      },
      {
        title: 'Philosophers and Kings: Plato, Republic, I-II',
        page: '/political-science/plsc-114/lecture-4',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall06/plsc114/mp3/plsc114_04_092006.mp3',
        durationMs: 2834600,
      },
      {
        title: 'Philosophers and Kings: Plato, Republic, III-IV',
        page: '/political-science/plsc-114/lecture-5',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall06/plsc114/mp3/plsc114_05_092506.mp3',
        durationMs: 2837870,
      },
      {
        title: 'Philosophers and Kings: Plato, Republic, V',
        page: '/political-science/plsc-114/lecture-6',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall06/plsc114/mp3/plsc114_06_092706.mp3',
        durationMs: 2709090,
      },
      {
        title: 'The Mixed Regime and the Rule of Law: Aristotle, Politics, I, III',
        page: '/political-science/plsc-114/lecture-7',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall06/plsc114/mp3/plsc114_07_100406.mp3',
        durationMs: 2625860,
      },
      {
        title: 'The Mixed Regime and the Rule of Law: Aristotle, Politics, IV',
        page: '/political-science/plsc-114/lecture-8',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall06/plsc114/mp3/plsc114_08_100906.mp3',
        durationMs: 2878310,
      },
      {
        title: 'The Mixed Regime and the Rule of Law: Aristotle, Politics, VII',
        page: '/political-science/plsc-114/lecture-9',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall06/plsc114/mp3/plsc114_09_101106.mp3',
        durationMs: 2772670,
      },
      {
        title: 'New Modes and Orders: Machiavelli, The Prince (chaps. 1-12)',
        page: '/political-science/plsc-114/lecture-10',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall06/plsc114/mp3/plsc114_10_101306.mp3',
        durationMs: 2241100,
      },
      {
        title: 'New Modes and Orders: Machiavelli, The Prince (chaps. 13-26)',
        page: '/political-science/plsc-114/lecture-11',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall06/plsc114/mp3/plsc114_11_101606.mp3',
        durationMs: 2608410,
      },
      {
        title: 'The Sovereign State: Hobbes, Leviathan',
        page: '/political-science/plsc-114/lecture-12',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall06/plsc114/mp3/plsc114_12_101806.mp3',
        durationMs: 2728830,
      },
      {
        title: 'The Sovereign State: Hobbes, Leviathan',
        page: '/political-science/plsc-114/lecture-13',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall06/plsc114/mp3/plsc114_13_102306.mp3',
        durationMs: 2783350,
      },
      {
        title: 'The Sovereign State: Hobbes, Leviathan',
        page: '/political-science/plsc-114/lecture-14',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall06/plsc114/mp3/plsc114_14_102506.mp3',
        durationMs: 2663660,
      },
      {
        title: 'Constitutional Government: Locke, Second Treatise (1-5)',
        page: '/political-science/plsc-114/lecture-15',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall06/plsc114/mp3/plsc114_15_103006.mp3',
        durationMs: 2680740,
      },
      {
        title: 'Constitutional Government: Locke, Second Treatise (7-12)',
        page: '/political-science/plsc-114/lecture-16',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall06/plsc114/mp3/plsc114_16_110106.mp3',
        durationMs: 2712010,
      },
      {
        title: 'Constitutional Government: Locke, Second Treatise (13-19)',
        page: '/political-science/plsc-114/lecture-17',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall06/plsc114/mp3/plsc114_17_110606.mp3',
        durationMs: 2711410,
      },
      {
        title:
          'Democracy and Participation: Rousseau, Discourse on Inequality (Author’s Preface, Part I)',
        page: '/political-science/plsc-114/lecture-18',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall06/plsc114/mp3/plsc114_18_110806.mp3',
        durationMs: 2632390,
      },
      {
        title: 'Democracy and Participation: Rousseau, Discourse on Inequality (Part II)',
        page: '/political-science/plsc-114/lecture-19',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall06/plsc114/mp3/plsc114_19_111306.mp3',
        durationMs: 2495870,
      },
      {
        title: 'Democracy and Participation: Rousseau, Social Contract, I-II',
        page: '/political-science/plsc-114/lecture-20',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall06/plsc114/mp3/plsc114_20_111506.mp3',
        durationMs: 2438270,
      },
      {
        title: 'Democratic Statecraft: Tocqueville, Democracy in America',
        page: '/political-science/plsc-114/lecture-21',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall06/plsc114/mp3/plsc114_21_112706.mp3',
        durationMs: 2524270,
      },
      {
        title: 'Democratic Statecraft: Tocqueville, Democracy in America',
        page: '/political-science/plsc-114/lecture-22',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall06/plsc114/mp3/plsc114_22_112906.mp3',
        durationMs: 2292830,
      },
      {
        title: 'Democratic Statecraft: Tocqueville, Democracy in America',
        page: '/political-science/plsc-114/lecture-23',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall06/plsc114/mp3/plsc114_23_120406.mp3',
        durationMs: 3033950,
      },
      {
        title: 'In Defense of Politics',
        page: '/political-science/plsc-114/lecture-24',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall06/plsc114/mp3/plsc114_24_120606.mp3',
        durationMs: 2341470,
      },
    ],
  },
  {
    id: 'psyc-110',
    code: 'PSYC 110',
    title: 'Introduction to Psychology',
    lecturer: 'Paul Bloom',
    term: 'Spring 2007',
    department: 'Psychology',
    page: '/introduction-psychology/psyc-110',
    description:
      'What do your dreams mean? Do men and women differ in the nature and intensity of their sexual desires? Can apes learn sign language? Why can’t we tickle ourselves? This course tries to answer these questions and many others, providing a comprehensive overview of the scientific study of thought and behavior. It explores topics such as perception, communication, learning, memory, decision-making, religion, persuasion, love, lust, hunger, art, fiction, and dreams. We will look at how these aspects of the mind develop in children, how they differ across people, how they are wired-up in the brain, and how they break down due to illness and injury.',
    archive: 'oyc_Introduction_to_Psychology',
    host: 'yale',
    lectures: [
      {
        title: 'Introduction',
        page: '/psychology/psyc-110/lecture-1',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring07/psyc110/mp3/psyc110_01_011707.mp3',
        durationMs: 1765620,
      },
      {
        title: 'Foundations: This Is Your Brain',
        page: '/psychology/psyc-110/lecture-2',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring07/psyc110/mp3/psyc110_02_012207.mp3',
        durationMs: 3186870,
      },
      {
        title: 'Foundations: Freud',
        page: '/psychology/psyc-110/lecture-3',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring07/psyc110/mp3/psyc110_03_012407.mp3',
        durationMs: 3378810,
      },
      {
        title: 'Foundations: Skinner',
        page: '/psychology/psyc-110/lecture-4',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring07/psyc110/mp3/psyc110_04_012907.mp3',
        durationMs: 3515120,
      },
      {
        title: 'What Is It Like to Be a Baby: The Development of Thought',
        page: '/psychology/psyc-110/lecture-5',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring07/psyc110/mp3/psyc110_05_013107.mp3',
        durationMs: 2926140,
      },
      {
        title: 'How Do We Communicate?: Language in the Brain, Mouth and the Hands',
        page: '/psychology/psyc-110/lecture-6',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring07/psyc110/mp3/psyc110_06_020507.mp3',
        durationMs: 3378810,
      },
      {
        title:
          'Conscious of the Present; Conscious of the Past: Language (cont.); Vision and Memory',
        page: '/psychology/psyc-110/lecture-7',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring07/psyc110/mp3/psyc110_07_020707.mp3',
        durationMs: 3571230,
      },
      {
        title: 'Conscious of the Present; Conscious of the Past: Vision and Memory (cont.)',
        page: '/psychology/psyc-110/lecture-8',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring07/psyc110/mp3/psyc110_08_021207.mp3',
        durationMs: 3571210,
      },
      {
        title: 'Evolution, Emotion, and Reason: Love (Guest Lecture by Professor Peter Salovey)',
        page: '/psychology/psyc-110/lecture-9',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring07/psyc110/mp3/psyc110_09_021407.mp3',
        durationMs: 4160970,
      },
      {
        title: 'Evolution, Emotion, and Reason: Evolution and Rationality',
        page: '/psychology/psyc-110/lecture-10',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring07/psyc110/mp3/psyc110_10_021907.mp3',
        durationMs: 3576980,
      },
      {
        title: 'Evolution, Emotion, and Reason: Emotions, Part I',
        page: '/psychology/psyc-110/lecture-11',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring07/psyc110/mp3/psyc110_11_022107.mp3',
        durationMs: 3183340,
      },
      {
        title: 'Evolution, Emotion, and Reason: Emotions, Part II',
        page: '/psychology/psyc-110/lecture-12',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring07/psyc110/mp3/psyc110_12_022607.mp3',
        durationMs: 3353810,
      },
      {
        title: 'Why Are People Different?: Differences',
        page: '/psychology/psyc-110/lecture-13',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring07/psyc110/mp3/psyc110_13_030707.mp3',
        durationMs: 3937550,
      },
      {
        title: 'What Motivates Us: Sex',
        page: '/psychology/psyc-110/lecture-14',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring07/psyc110/mp3/psyc110_14_032607.mp3',
        durationMs: 3155650,
      },
      {
        title: 'A Person in the World of People: Morality',
        page: '/psychology/psyc-110/lecture-15',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring07/psyc110/mp3/psyc110_15_040407.mp3',
        durationMs: 3665220,
      },
      {
        title: 'A Person in the World of People: Self and Other, Part I',
        page: '/psychology/psyc-110/lecture-16',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring07/psyc110/mp3/psyc110_16_040907.mp3',
        durationMs: 3483410,
      },
      {
        title:
          'A Person in the World of People: Self and Other, Part II; Some Mysteries: Sleep, Dreams, and Laughter',
        page: '/psychology/psyc-110/lecture-17',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring07/psyc110/mp3/psyc110_17_041607.mp3',
        durationMs: 3881310,
      },
      {
        title:
          'What Happens When Things Go Wrong: Mental Illness, Part I (Guest Lecture by Professor Susan Nolen-Hoeksema)',
        page: '/psychology/psyc-110/lecture-18',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring07/psyc110/mp3/psyc110_18_041807.mp3',
        durationMs: 3254500,
      },
      {
        title: 'What Happens When Things Go Wrong: Mental Illness, Part II',
        page: '/psychology/psyc-110/lecture-19',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring07/psyc110/mp3/psyc110_19_042307.mp3',
        durationMs: 3395690,
      },
      {
        title: 'The Good Life: Happiness',
        page: '/psychology/psyc-110/lecture-20',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring07/psyc110/mp3/psyc110_20_042507.mp3',
        durationMs: 2843590,
      },
    ],
  },
  {
    id: 'rlst-152',
    code: 'RLST 152',
    title: 'Introduction to the New Testament History and Literature',
    lecturer: 'Dale B. Martin',
    term: 'Spring 2009',
    department: 'Religious Studies',
    page: '/religious-studies/rlst-152',
    description:
      'This course provides a historical study of the origins of Christianity by analyzing the literature of the earliest Christian movements in historical context, concentrating on the New Testament. Although theological themes will occupy much of our attention, the course does not attempt a theological appropriation of the New Testament as scripture. Rather, the importance of the New Testament and other early Christian documents as ancient literature and as sources for historical study will be emphasized. A central organizing theme of the course will focus on the differences within early Christianity (-ies).',
    archive: 'oyc_Introduction_to_the_New_Testament_History_and_Literature',
    host: 'yale',
    lectures: [
      {
        title: 'Introduction: Why Study the New Testament?',
        page: '/religious-studies/rlst-152/lecture-1',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring09/rlst152/mp3/rlst152_01_011209.mp3',
        durationMs: 2411810,
      },
      {
        title: 'From Stories to Canon',
        page: '/religious-studies/rlst-152/lecture-2',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring09/rlst152/mp3/rlst152_02_011409.mp3',
        durationMs: 2933840,
      },
      {
        title: 'The Greco-Roman World',
        page: '/religious-studies/rlst-152/lecture-3',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring09/rlst152/mp3/rlst152_03_011609.mp3',
        durationMs: 2921380,
      },
      {
        title: 'Judaism in the First Century',
        page: '/religious-studies/rlst-152/lecture-4',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring09/rlst152/mp3/rlst152_04_012109.mp3',
        durationMs: 2908090,
      },
      {
        title: 'The New Testament as History',
        page: '/religious-studies/rlst-152/lecture-5',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring09/rlst152/mp3/rlst152_05_012609.mp3',
        durationMs: 2201340,
      },
      {
        title: 'The Gospel of Mark',
        page: '/religious-studies/rlst-152/lecture-6',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring09/rlst152/mp3/rlst152_06_012809.mp3',
        durationMs: 2677190,
      },
      {
        title: 'The Gospel of Matthew',
        page: '/religious-studies/rlst-152/lecture-7',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring09/rlst152/mp3/rlst152_07_020209.mp3',
        durationMs: 2896410,
      },
      {
        title: 'The Gospel of Thomas',
        page: '/religious-studies/rlst-152/lecture-8',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring09/rlst152/mp3/rlst152_08_020409.mp3',
        durationMs: 3028830,
      },
      {
        title: 'The Gospel of Luke',
        page: '/religious-studies/rlst-152/lecture-9',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring09/rlst152/mp3/rlst152_09_020909.mp3',
        durationMs: 2956100,
      },
      {
        title: 'The Acts of the Apostles',
        page: '/religious-studies/rlst-152/lecture-10',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring09/rlst152/mp3/rlst152_10_021109.mp3',
        durationMs: 2914770,
      },
      {
        title: 'Johannine Christianity: the Gospel',
        page: '/religious-studies/rlst-152/lecture-11',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring09/rlst152/mp3/rlst152_11_021609.mp3',
        durationMs: 2989930,
      },
      {
        title: 'Johannine Christianity: the Letters',
        page: '/religious-studies/rlst-152/lecture-12',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring09/rlst152/mp3/rlst152_12_021809.mp3',
        durationMs: 3055550,
      },
      {
        title: 'The Historical Jesus',
        page: '/religious-studies/rlst-152/lecture-13',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring09/rlst152/mp3/rlst152_13_022309.mp3',
        durationMs: 3148780,
      },
      {
        title: 'Paul as Missionary',
        page: '/religious-studies/rlst-152/lecture-14',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring09/rlst152/mp3/rlst152_14_022509.mp3',
        durationMs: 3014510,
      },
      {
        title: 'Paul as Pastor',
        page: '/religious-studies/rlst-152/lecture-15',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring09/rlst152/mp3/rlst152_15_030209.mp3',
        durationMs: 2850830,
      },
      {
        title: 'Paul as Jewish Theologian',
        page: '/religious-studies/rlst-152/lecture-16',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring09/rlst152/mp3/rlst152_16_030409.mp3',
        durationMs: 2869660,
      },
      {
        title: 'Paul’s Disciples',
        page: '/religious-studies/rlst-152/lecture-17',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring09/rlst152/mp3/rlst152_17_032309.mp3',
        durationMs: 2991650,
      },
      {
        title: 'Arguing with Paul?',
        page: '/religious-studies/rlst-152/lecture-18',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring09/rlst152/mp3/rlst152_18_032509.mp3',
        durationMs: 2751850,
      },
      {
        title: 'The “Household” Paul: the Pastorals',
        page: '/religious-studies/rlst-152/lecture-19',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring09/rlst152/mp3/rlst152_19_033009.mp3',
        durationMs: 2763290,
      },
      {
        title: 'The “Anti-household” Paul: Thecla',
        page: '/religious-studies/rlst-152/lecture-20',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring09/rlst152/mp3/rlst152_20_040109.mp3',
        durationMs: 2913890,
      },
      {
        title: 'Interpreting Scripture: Hebrews',
        page: '/religious-studies/rlst-152/lecture-21',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring09/rlst152/mp3/rlst152_21_040609.mp3',
        durationMs: 2885470,
      },
      {
        title: 'Interpreting Scripture: Medieval Interpretations',
        page: '/religious-studies/rlst-152/lecture-22',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring09/rlst152/mp3/rlst152_22_040809.mp3',
        durationMs: 2969000,
      },
      {
        title: 'Apocalyptic and Resistance',
        page: '/religious-studies/rlst-152/lecture-23',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring09/rlst152/mp3/rlst152_23_041309.mp3',
        durationMs: 2831520,
      },
      {
        title: 'Apocalyptic and Accommodation',
        page: '/religious-studies/rlst-152/lecture-24',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring09/rlst152/mp3/rlst152_24_041509.mp3',
        durationMs: 2899070,
      },
      {
        title: 'Ecclesiastical Institutions: Unity, Martyrs, and Bishops',
        page: '/religious-studies/rlst-152/lecture-25',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring09/rlst152/mp3/rlst152_25_042009.mp3',
        durationMs: 2903570,
      },
      {
        title: 'The “Afterlife” of the New Testament and Postmodern Interpretation',
        page: '/religious-studies/rlst-152/lecture-26',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/spring09/rlst152/mp3/rlst152_26_042209.mp3',
        durationMs: 2860520,
      },
    ],
  },
  {
    id: 'rlst-145',
    code: 'RLST 145',
    title: 'Introduction to the Old Testament (Hebrew Bible)',
    lecturer: 'Christine Hayes',
    term: 'Fall 2006',
    department: 'Religious Studies',
    page: '/religious-studies/rlst-145',
    description:
      'This course examines the Old Testament (Hebrew Bible) as an expression of the religious life and thought of ancient Israel, and a foundational document of Western civilization. A wide range of methodologies, including source criticism and the historical-critical school, tradition criticism, redaction criticism, and literary and canonical approaches are applied to the study and interpretation of the Bible. Special emphasis is placed on the Bible against the backdrop of its historical and cultural setting in the Ancient Near East.',
    archive: 'oyc_Introduction_to_the_Old_Testament_Hebrew_Bible',
    host: 'yale',
    lectures: [
      {
        title: 'The Parts of the Whole',
        page: '/religious-studies/rlst-145/lecture-1',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall06/rlst145/mp3/rlst145_01_090606.mp3',
        durationMs: 2745740,
      },
      {
        title: 'The Hebrew Bible in Its Ancient Near Eastern Setting: Biblical Religion in Context',
        page: '/religious-studies/rlst-145/lecture-2',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall06/rlst145/mp3/rlst145_02_091106.mp3',
        durationMs: 2771700,
      },
      {
        title: 'The Hebrew Bible in Its Ancient Near Eastern Setting: Genesis 1-4 in Context',
        page: '/religious-studies/rlst-145/lecture-3',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall06/rlst145/mp3/rlst145_03_091306.mp3',
        durationMs: 2863050,
      },
      {
        title:
          'Doublets and Contradictions, Seams and Sources: Genesis 5-11 and the Historical-Critical Method',
        page: '/religious-studies/rlst-145/lecture-4',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall06/rlst145/mp3/rlst145_04_091806.mp3',
        durationMs: 2872430,
      },
      {
        title: 'Critical Approaches to the Bible: Introduction to Genesis 12-50',
        page: '/religious-studies/rlst-145/lecture-5',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall06/rlst145/mp3/rlst145_05_092006.mp3',
        durationMs: 2924230,
      },
      {
        title: 'Biblical Narrative: The Stories of the Patriarchs (Genesis 12-36)',
        page: '/religious-studies/rlst-145/lecture-6',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall06/rlst145/mp3/rlst145_06_092506.mp3',
        durationMs: 2956620,
      },
      {
        title: 'Israel in Egypt: Moses and the Beginning of Yahwism (Genesis 37- Exodus 4)',
        page: '/religious-studies/rlst-145/lecture-7',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall06/rlst145/mp3/rlst145_07_092706.mp3',
        durationMs: 2762820,
      },
      {
        title: 'Exodus: From Egypt to Sinai (Exodus 5-24, 32; Numbers)',
        page: '/religious-studies/rlst-145/lecture-8',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall06/rlst145/mp3/rlst145_08_100406.mp3',
        durationMs: 2854590,
      },
      {
        title:
          'The Priestly Legacy: Cult and Sacrifice, Purity and Holiness in Leviticus and Numbers',
        page: '/religious-studies/rlst-145/lecture-9',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall06/rlst145/mp3/rlst145_09_100906.mp3',
        durationMs: 2915110,
      },
      {
        title:
          'Biblical Law: The Three Legal Corpora of JE (Exodus), P (Leviticus and Numbers) and D (Deuteronomy)',
        page: '/religious-studies/rlst-145/lecture-10',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall06/rlst145/mp3/rlst145_10_101106.mp3',
        durationMs: 3042250,
      },
      {
        title: 'On the Steps of Moab: Deuteronomy',
        page: '/religious-studies/rlst-145/lecture-11',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall06/rlst145/mp3/rlst145_11_101606.mp3',
        durationMs: 2875070,
      },
      {
        title: 'The Deuteronomistic History: Life in the Land (Joshua and Judges)',
        page: '/religious-studies/rlst-145/lecture-12',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall06/rlst145/mp3/rlst145_12_101806.mp3',
        durationMs: 3018560,
      },
      {
        title: 'The Deuteronomistic History: Prophets and Kings (1 and 2 Samuel)',
        page: '/religious-studies/rlst-145/lecture-13',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall06/rlst145/mp3/rlst145_13_102306.mp3',
        durationMs: 2971170,
      },
      {
        title: 'The Deuteronomistic History: Response to Catastrophe (1 and 2 Kings)',
        page: '/religious-studies/rlst-145/lecture-14',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall06/rlst145/mp3/rlst145_14_102506.mp3',
        durationMs: 3094600,
      },
      {
        title: 'Hebrew Prophecy: The Non-Literary Prophets',
        page: '/religious-studies/rlst-145/lecture-15',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall06/rlst145/mp3/rlst145_15_103006.mp3',
        durationMs: 2990500,
      },
      {
        title: 'Literary Prophecy: Amos',
        page: '/religious-studies/rlst-145/lecture-16',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall06/rlst145/mp3/rlst145_16_110106.mp3',
        durationMs: 2879480,
      },
      {
        title: 'Literary Prophecy: Hosea and Isaiah',
        page: '/religious-studies/rlst-145/lecture-17',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall06/rlst145/mp3/rlst145_17_110606.mp3',
        durationMs: 2937680,
      },
      {
        title: 'Literary Prophecy: Micah, Zephaniah, Nahum and Habbakuk',
        page: '/religious-studies/rlst-145/lecture-18',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall06/rlst145/mp3/rlst145_18_110806.mp3',
        durationMs: 2919920,
      },
      {
        title: 'Literary Prophecy: Perspectives on the Exile (Jeremiah, Ezekiel and 2nd Isaiah)',
        page: '/religious-studies/rlst-145/lecture-19',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall06/rlst145/mp3/rlst145_19_111306.mp3',
        durationMs: 2827130,
      },
      {
        title: 'Responses to Suffering and Evil: Lamentations and Wisdom Literature',
        page: '/religious-studies/rlst-145/lecture-20',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall06/rlst145/mp3/rlst145_20_111506.mp3',
        durationMs: 3172680,
      },
      {
        title: 'Biblical Poetry: Psalms and Song of Songs',
        page: '/religious-studies/rlst-145/lecture-21',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall06/rlst145/mp3/rlst145_21_112706.mp3',
        durationMs: 2919530,
      },
      {
        title: 'The Restoration: 1 and 2 Chronicles, Ezra and Nehemiah',
        page: '/religious-studies/rlst-145/lecture-22',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall06/rlst145/mp3/rlst145_22_112906.mp3',
        durationMs: 2957200,
      },
      {
        title: 'Visions of the End: Daniel and Apocalyptic Literature',
        page: '/religious-studies/rlst-145/lecture-23',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall06/rlst145/mp3/rlst145_23_120406.mp3',
        durationMs: 2990500,
      },
      {
        title: 'Alternative Visions: Esther, Ruth, and Jonah',
        page: '/religious-studies/rlst-145/lecture-24',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall06/rlst145/mp3/rlst145_24_120606.mp3',
        durationMs: 1734560,
      },
    ],
  },
  {
    id: 'socy-151',
    code: 'SOCY 151',
    title: 'Foundations of Modern Social Theory',
    lecturer: 'Iván Szelényi',
    term: 'Fall 2009',
    department: 'Sociology',
    page: '/sociology/socy-151',
    description:
      'This course provides an overview of major works of social thought from the beginning of the modern era through the 1920s. Attention is paid to social and intellectual contexts, conceptual frameworks and methods, and contributions to contemporary social analysis. Writers include Hobbes, Locke, Rousseau, Montesquieu, Adam Smith, Marx, Weber, and Durkheim.',
    archive: 'oyc_Foundations_of_Modern_Social_Theory',
    host: 'yale',
    lectures: [
      {
        title: 'Introduction',
        page: '/sociology/socy-151/lecture-1',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall09/socy151/mp3/socy151_01_090309.mp3',
        durationMs: 2751200,
      },
      {
        title: 'Hobbes: Authority, Human Rights and Social Order',
        page: '/sociology/socy-151/lecture-2',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall09/socy151/mp3/socy151_02_090809.mp3',
        durationMs: 2575550,
      },
      {
        title: 'Locke: Equality, Freedom, Property and the Right to Dissent',
        page: '/sociology/socy-151/lecture-3',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall09/socy151/mp3/socy151_03_091009.mp3',
        durationMs: 2722850,
      },
      {
        title: 'Montesquieu: The Division of Powers',
        page: '/sociology/socy-151/lecture-4',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall09/socy151/mp3/socy151_04_091509.mp3',
        durationMs: 2652710,
      },
      {
        title: 'Rousseau: Popular Sovereignty and General Will',
        page: '/sociology/socy-151/lecture-5',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall09/socy151/mp3/socy151_05_091709.mp3',
        durationMs: 2428140,
      },
      {
        title: 'Rousseau on State of Nature and Education',
        page: '/sociology/socy-151/lecture-6',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall09/socy151/mp3/socy151_06_092209.mp3',
        durationMs: 2641170,
      },
      {
        title: 'Mill: Utilitarianism and Liberty',
        page: '/sociology/socy-151/lecture-7',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall09/socy151/mp3/socy151_07_092409.mp3',
        durationMs: 2534750,
      },
      {
        title: 'Smith: The Invisible Hand',
        page: '/sociology/socy-151/lecture-8',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall09/socy151/mp3/socy151_08_092909.mp3',
        durationMs: 2790070,
      },
      {
        title: 'Marx’s Theory of Alienation',
        page: '/sociology/socy-151/lecture-9',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall09/socy151/mp3/socy151_09_100109.mp3',
        durationMs: 2883580,
      },
      {
        title: 'Marx’s Theory of Historical Materialism',
        page: '/sociology/socy-151/lecture-10',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall09/socy151/mp3/socy151_10_100609.mp3',
        durationMs: 3023260,
      },
      {
        title: 'Marx’s Theory of Historical Materialism (cont.)',
        page: '/sociology/socy-151/lecture-11',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall09/socy151/mp3/socy151_11_100809.mp3',
        durationMs: 2932880,
      },
      {
        title: 'Marx’s Theory of History',
        page: '/sociology/socy-151/lecture-12',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall09/socy151/mp3/socy151_12_101309.mp3',
        durationMs: 3089930,
      },
      {
        title: 'Marx’s Theory of Class and Exploitation',
        page: '/sociology/socy-151/lecture-13',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall09/socy151/mp3/socy151_13_101509.mp3',
        durationMs: 3072530,
      },
      {
        title: 'Nietzsche on Power, Knowledge and Morality',
        page: '/sociology/socy-151/lecture-14',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall09/socy151/mp3/socy151_14_102009.mp3',
        durationMs: 2777470,
      },
      {
        title: 'Freud on Sexuality and Civilization',
        page: '/sociology/socy-151/lecture-15',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall09/socy151/mp3/socy151_15_102209.mp3',
        durationMs: 3209040,
      },
      {
        title: 'Weber on Protestantism and Capitalism',
        page: '/sociology/socy-151/lecture-16',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall09/socy151/mp3/socy151_16_102709.mp3',
        durationMs: 3074570,
      },
      {
        title: 'Conceptual Foundations of Weber’s Theory of Domination',
        page: '/sociology/socy-151/lecture-17',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall09/socy151/mp3/socy151_17_102909.mp3',
        durationMs: 3165990,
      },
      {
        title: 'Weber on Traditional Authority',
        page: '/sociology/socy-151/lecture-18',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall09/socy151/mp3/socy151_18_110309.mp3',
        durationMs: 3018010,
      },
      {
        title: 'Weber on Charismatic Authority',
        page: '/sociology/socy-151/lecture-19',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall09/socy151/mp3/socy151_19_110509.mp3',
        durationMs: 2965630,
      },
      {
        title: 'Weber on Legal-Rational Authority',
        page: '/sociology/socy-151/lecture-20',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall09/socy151/mp3/socy151_20_111009.mp3',
        durationMs: 2873580,
      },
      {
        title: 'Weber’s Theory of Class',
        page: '/sociology/socy-151/lecture-21',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall09/socy151/mp3/socy151_21_111209.mp3',
        durationMs: 2677190,
      },
      {
        title: 'Durkheim and Types of Social Solidarity',
        page: '/sociology/socy-151/lecture-22',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall09/socy151/mp3/socy151_22_111709.mp3',
        durationMs: 2259050,
      },
      {
        title: 'Durkheim’s Theory of Anomie',
        page: '/sociology/socy-151/lecture-23',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall09/socy151/mp3/socy151_23_111909.mp3',
        durationMs: 2801480,
      },
      {
        title: 'Durkheim on Suicide',
        page: '/sociology/socy-151/lecture-24',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall09/socy151/mp3/socy151_24_120109.mp3',
        durationMs: 3048340,
      },
      {
        title: 'Durkheim and Social Facts',
        page: '/sociology/socy-151/lecture-25',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall09/socy151/mp3/socy151_25_120309.mp3',
        durationMs: 3068950,
      },
    ],
  },
  {
    id: 'span-300',
    code: 'SPAN 300',
    title: 'Cervantes’ Don Quixote',
    lecturer: 'Roberto González Echevarría',
    term: 'Fall 2009',
    department: 'Spanish and Portuguese',
    page: '/spanish-and-portuguese/span-300',
    description:
      'The course facilitates a close reading of Don Quixote in the artistic and historical context of renaissance and baroque Spain. Students are also expected to read four of Cervantes’ Exemplary Stories, Cervantes’ Don Quixote: A Casebook, and J.H. Elliott’s Imperial Spain. Cervantes’ work will be discussed in relation to paintings by Velázquez. The question of why Don Quixote is read today will be addressed throughout the course. Students are expected to know the book, the background readings and the materials covered in the lectures and class discussions.',
    archive: 'oyc_Cervantes_Don_Quixote',
    host: 'yale',
    lectures: [
      {
        title: 'Introduction',
        page: '/spanish-and-portuguese/span-300/lecture-1',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall09/span300/mp3/span300_01_090309.mp3',
        durationMs: 3509920,
      },
      {
        title: 'Don Quixote, Part I: Front Matter and Chapters I-X',
        page: '/spanish-and-portuguese/span-300/lecture-2',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall09/span300/mp3/span300_02_090809.mp3',
        durationMs: 3433780,
      },
      {
        title: 'Don Quixote, Part I: Chapters I-X (cont.)',
        page: '/spanish-and-portuguese/span-300/lecture-3',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall09/span300/mp3/span300_03_091009.mp3',
        durationMs: 4121270,
      },
      {
        title: 'Don Quixote, Part I: Chapters XI-XX',
        page: '/spanish-and-portuguese/span-300/lecture-4',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall09/span300/mp3/span300_04_091509.mp3',
        durationMs: 3279310,
      },
      {
        title: 'Don Quixote, Part I: Chapters XI-XX (cont.)',
        page: '/spanish-and-portuguese/span-300/lecture-5',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall09/span300/mp3/span300_05_091709.mp3',
        durationMs: 3662690,
      },
      {
        title: 'Don Quixote, Part I: Chapters XXI-XXVI',
        page: '/spanish-and-portuguese/span-300/lecture-6',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall09/span300/mp3/span300_06_092209.mp3',
        durationMs: 3813390,
      },
      {
        title: 'Don Quixote, Part I: Chapters XXI-XXVI (cont.)',
        page: '/spanish-and-portuguese/span-300/lecture-7',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall09/span300/mp3/span300_07_092409.mp3',
        durationMs: 3650720,
      },
      {
        title: 'Don Quixote, Part I: Chapters XXVII-XXXV',
        page: '/spanish-and-portuguese/span-300/lecture-8',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall09/span300/mp3/span300_08_092909.mp3',
        durationMs: 3700040,
      },
      {
        title: 'Don Quixote, Part I: Chapters XXVII-XXXV (cont.)',
        page: '/spanish-and-portuguese/span-300/lecture-9',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall09/span300/mp3/span300_09_100109.mp3',
        durationMs: 3430590,
      },
      {
        title: 'Don Quixote, Part I: Chapters XXXVI-LII',
        page: '/spanish-and-portuguese/span-300/lecture-10',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall09/span300/mp3/span300_10_100609.mp3',
        durationMs: 3490850,
      },
      {
        title: 'Don Quixote, Part I: Chapters XXXVI-LII (cont.)',
        page: '/spanish-and-portuguese/span-300/lecture-11',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall09/span300/mp3/span300_11_100809.mp3',
        durationMs: 3464080,
      },
      {
        title: 'Don Quixote, Introduction to Part II',
        page: '/spanish-and-portuguese/span-300/lecture-12',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall09/span300/mp3/span300_12_101509.mp3',
        durationMs: 3188090,
      },
      {
        title: 'Don Quixote, Part II: Front Matter and Chapters I-XI',
        page: '/spanish-and-portuguese/span-300/lecture-13',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall09/span300/mp3/span300_13_102009.mp3',
        durationMs: 3447490,
      },
      {
        title: 'Don Quixote, Part II: Front Matter and Chapters I-XI (cont.)',
        page: '/spanish-and-portuguese/span-300/lecture-14',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall09/span300/mp3/span300_14_102209.mp3',
        durationMs: 3784180,
      },
      {
        title: 'Don Quixote, Part II: Chapters XII-XXI',
        page: '/spanish-and-portuguese/span-300/lecture-15',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall09/span300/mp3/span300_15_102709.mp3',
        durationMs: 3651820,
      },
      {
        title: 'Don Quixote, Part II: Chapters XII-XXI (cont.)',
        page: '/spanish-and-portuguese/span-300/lecture-16',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall09/span300/mp3/span300_16_102909.mp3',
        durationMs: 3264740,
      },
      {
        title: 'Don Quixote, Part II: Chapters XXII-XXXV',
        page: '/spanish-and-portuguese/span-300/lecture-17',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall09/span300/mp3/span300_17_110309.mp3',
        durationMs: 3617420,
      },
      {
        title: 'Don Quixote, Part II: Chapters XXII-XXXV (cont.)',
        page: '/spanish-and-portuguese/span-300/lecture-18',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall09/span300/mp3/span300_18_110509.mp3',
        durationMs: 3539570,
      },
      {
        title: 'Don Quixote, Part II: Chapters XXXVI-LIII',
        page: '/spanish-and-portuguese/span-300/lecture-19',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall09/span300/mp3/span300_19_111009.mp3',
        durationMs: 3711950,
      },
      {
        title: 'Don Quixote, Part II: Chapters XXXVI-LIII (cont.)',
        page: '/spanish-and-portuguese/span-300/lecture-20',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall09/span300/mp3/span300_20_111209.mp3',
        durationMs: 3413270,
      },
      {
        title: 'Don Quixote, Part II: Chapters LIV-LXX',
        page: '/spanish-and-portuguese/span-300/lecture-21',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall09/span300/mp3/span300_21_111709.mp3',
        durationMs: 3333130,
      },
      {
        title: 'Don Quixote, Part II: Chapters LIV-LXX (cont.)',
        page: '/spanish-and-portuguese/span-300/lecture-22',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall09/span300/mp3/span300_22_111909.mp3',
        durationMs: 3533070,
      },
      {
        title: 'Don Quixote, Part II: Chapters LXXI-LXXIV',
        page: '/spanish-and-portuguese/span-300/lecture-23',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall09/span300/mp3/span300_23_120109.mp3',
        durationMs: 3577320,
      },
      {
        title: 'Don Quixote, Part II: Chapters LXXI-LXXIV (cont.)',
        page: '/spanish-and-portuguese/span-300/lecture-24',
        audio:
          'https://oyc.yale.edu/sites/default/files/courses/fall09/span300/mp3/span300_24_120309.mp3',
        durationMs: 3894500,
      },
    ],
  },
];
