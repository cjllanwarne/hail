package is.hail.expr.ir

import is.hail.HailSuite
import is.hail.expr.Nat
import is.hail.expr.ir.PruneDeadFields.TypeState
import is.hail.expr.ir.defs._
import is.hail.expr.ir.lowering.ExecuteRelational
import is.hail.methods.{ForceCountMatrixTable, ForceCountTable}
import is.hail.rvd.RVD
import is.hail.types._
import is.hail.types.virtual._
import is.hail.utils._

import scala.collection.mutable
import scala.collection.mutable.ArrayBuffer

import org.apache.spark.sql.Row
import org.json4s.JValue
import org.scalatest
import org.scalatest.Inspectors.forAll
import org.scalatest.enablers.InspectorAsserting.assertingNatureOfAssertion
import org.testng.annotations.{DataProvider, Test}

class PruneSuite extends HailSuite {
  @Test def testUnionType(): scalatest.Assertion = {
    val base = TStruct(
      "a" -> TStruct(
        "aa" -> TInt32,
        "ab" -> TStruct(
          "aaa" -> TString
        ),
      ),
      "b" -> TInt32,
      "c" -> TArray(TStruct(
        "ca" -> TInt32
      )),
    )

    assert(PruneDeadFields.unify(base, TStruct.empty) == TStruct.empty)
    assert(PruneDeadFields.unify(base, TStruct("b" -> TInt32)) == TStruct("b" -> TInt32))
    assert(
      PruneDeadFields.unify(base, TStruct("a" -> TStruct.empty)) == TStruct("a" -> TStruct.empty)
    )
    assert(PruneDeadFields.unify(
      base,
      TStruct("a" -> TStruct.empty),
      TStruct("b" -> TInt32),
    ) == TStruct("a" -> TStruct.empty, "b" -> TInt32))
    assert(PruneDeadFields.unify(base, TStruct("c" -> TArray(TStruct.empty))) == TStruct(
      "c" -> TArray(TStruct.empty)
    ))
    assert(PruneDeadFields.unify(
      base,
      TStruct("a" -> TStruct("ab" -> TStruct.empty)),
      TStruct("c" -> TArray(TStruct.empty)),
    ) == TStruct("a" -> TStruct("ab" -> TStruct.empty), "c" -> TArray(TStruct.empty)))
  }

  @Test def testIsSupertype(): scalatest.Assertion = {
    val emptyTuple = TTuple.empty
    val tuple1Int = TTuple(TInt32)
    val tuple2Ints = TTuple(TInt32, TInt32)
    val tuple2IntsFirstRemoved = TTuple(IndexedSeq(TupleField(1, TInt32)))

    assert(PruneDeadFields.isSupertype(emptyTuple, tuple2Ints))
    assert(PruneDeadFields.isSupertype(tuple1Int, tuple2Ints))
    assert(PruneDeadFields.isSupertype(tuple2IntsFirstRemoved, tuple2Ints))
  }

  @Test def testIsSupertypeWithDistinctFieldTypes(): scalatest.Assertion = {
    val tuple2Ints = TTuple(TInt32, TFloat64)
    val tuple2IntsFirstRemoved = TTuple(IndexedSeq(TupleField(1, TFloat64)))

    assert(PruneDeadFields.isSupertype(tuple2IntsFirstRemoved, tuple2Ints))
  }

  def checkMemo(
    ir: BaseIR,
    requestedType: BaseType,
    expected: Array[BaseType],
    env: BindingEnv[Type] = BindingEnv.empty,
  ): scalatest.Assertion = {
    TypeCheck(ctx, ir, env)
    val irCopy = ir.deepCopy()
    assert(
      PruneDeadFields.isSupertype(requestedType, irCopy.typ),
      s"not supertype:\n  super: ${requestedType.parsableString()}\n  sub:   ${irCopy.typ.parsableString()}",
    )
    val ms = PruneDeadFields.ComputeMutableState(Memo.empty[BaseType], mutable.HashMap.empty)
    irCopy match {
      case mir: MatrixIR =>
        PruneDeadFields.memoizeMatrixIR(ctx, mir, requestedType.asInstanceOf[MatrixType], ms)
      case tir: TableIR =>
        PruneDeadFields.memoizeTableIR(ctx, tir, requestedType.asInstanceOf[TableType], ms)
      case ir: IR =>
        val envStates = env.mapValues(TypeState(_))
        PruneDeadFields.memoizeValueIR(ctx, ir, requestedType.asInstanceOf[Type], ms, envStates)
    }

    forAll(irCopy.children.zipWithIndex) { case (child, i) =>
      assert(
        expected(i) == null || expected(i) == ms.requestedType.lookup(child),
        s"For base IR $ir\n  Child $i with IR $child\n  Expected: ${expected(i)}\n  Actual:   ${ms.requestedType.get(child)}",
      )
    }
  }

  def checkRebuild[T <: BaseIR](
    ir: T,
    requestedType: BaseType,
    f: (T, T) => Boolean = (left: T, right: T) => left == right,
    env: BindingEnv[Type] = BindingEnv.empty,
  ): scalatest.Assertion = {
    TypeCheck(ctx, ir, env)
    val irCopy = ir.deepCopy()
    val ms = PruneDeadFields.ComputeMutableState(Memo.empty[BaseType], mutable.HashMap.empty)
    val rebuilt = (irCopy match {
      case mir: MatrixIR =>
        PruneDeadFields.memoizeMatrixIR(ctx, mir, requestedType.asInstanceOf[MatrixType], ms)
        PruneDeadFields.rebuild(ctx, mir, ms.rebuildState)
      case tir: TableIR =>
        PruneDeadFields.memoizeTableIR(ctx, tir, requestedType.asInstanceOf[TableType], ms)
        PruneDeadFields.rebuild(ctx, tir, ms.rebuildState)
      case ir: IR =>
        val envStates = env.mapValues(TypeState(_))
        PruneDeadFields.memoizeValueIR(ctx, ir, requestedType.asInstanceOf[Type], ms, envStates)
        PruneDeadFields.rebuildIR(
          ctx,
          ir,
          BindingEnv(Env.empty, Some(Env.empty), Some(Env.empty)),
          ms.rebuildState,
        )
    }).asInstanceOf[T]
    assert(
      f(ir, rebuilt),
      s"IR did not rebuild the same:\n  Base:    ${Pretty.sexprStyle(ir)}\n  Rebuilt: ${Pretty.sexprStyle(rebuilt)}",
    )
  }

  lazy val tab = TableLiteral(
    ExecuteRelational(
      ctx,
      TableKeyBy(
        TableParallelize(
          Literal(
            TStruct(
              "rows" -> TArray(TStruct(
                "1" -> TString,
                "2" -> TArray(TStruct("2A" -> TInt32)),
                "3" -> TString,
                "4" -> TStruct("A" -> TInt32, "B" -> TArray(TStruct("i" -> TString))),
                "5" -> TString,
              )),
              "global" -> TStruct("g1" -> TInt32, "g2" -> TInt32),
            ),
            Row(
              FastSeq(Row("hi", FastSeq(Row(1)), "bye", Row(2, FastSeq(Row("bar"))), "foo")),
              Row(5, 10),
            ),
          ),
          None,
        ),
        FastSeq("3"),
        false,
      ),
    ).asTableValue(ctx),
    theHailClassLoader,
  )

  lazy val tr = TableRead(
    tab.typ,
    false,
    new FakeTableReader {
      override def pathsUsed: Seq[String] = Seq.empty
      override def fullType: TableType = tab.typ
    },
  )

  lazy val mType = MatrixType(
    TStruct("g1" -> TInt32, "g2" -> TFloat64),
    FastSeq("ck"),
    TStruct("ck" -> TString, "c2" -> TInt32, "c3" -> TArray(TStruct("cc" -> TInt32))),
    FastSeq("rk"),
    TStruct(
      "rk" -> TInt32,
      "r2" -> TStruct("x" -> TInt32),
      "r3" -> TArray(TStruct("rr" -> TInt32)),
    ),
    TStruct("e1" -> TFloat64, "e2" -> TFloat64),
  )

  lazy val mat = MatrixLiteral(
    ctx,
    mType,
    RVD.empty(ctx, mType.canonicalTableType.canonicalRVDType),
    Row(1, 1.0),
    FastSeq(Row("1", 2, FastSeq(Row(3)))),
  )

  lazy val mr = MatrixRead(
    mat.typ,
    false,
    false,
    new MatrixReader {
      def pathsUsed: IndexedSeq[String] = FastSeq()

      override def columnCount: Option[Int] = None

      def partitionCounts: Option[IndexedSeq[Long]] = None

      def rowUIDType = TTuple(TInt64, TInt64)
      def colUIDType = TTuple(TInt64, TInt64)

      def fullMatrixTypeWithoutUIDs: MatrixType = mat.typ

      def lower(requestedType: MatrixType, dropCols: Boolean, dropRows: Boolean): TableIR = ???

      def toJValue: JValue = ???

      override def renderShort(): String = "mr"
    },
  )

  lazy val emptyTableDep = TableType(TStruct.empty, FastSeq(), TStruct.empty)

  def tableRefBoolean(tt: TableType, fields: String*): IR = {
    var let: IR = True()
    fields.foreach { f =>
      val split = f.split("\\.")
      var ir: IR = split(0) match {
        case "row" => Ref(TableIR.rowName, tt.rowType)
        case "global" => Ref(TableIR.globalName, tt.globalType)
      }

      split.tail.foreach(field => ir = GetField(ir, field))
      let = bindIR(ir)(_ => let)
    }
    let
  }

  def tableRefStruct(tt: TableType, fields: String*): IR =
    MakeStruct(tt.key.map(k => k -> GetField(Ref(TableIR.rowName, tt.rowType), k)) ++ FastSeq(
      "foo" -> tableRefBoolean(tt, fields: _*)
    ))

  def matrixRefBoolean(mt: MatrixType, fields: String*): IR = {
    var let: IR = True()
    fields.foreach { f =>
      val split = f.split("\\.")
      var ir: IR = split(0) match {
        case "va" => Ref(MatrixIR.rowName, mt.rowType)
        case "sa" => Ref(MatrixIR.colName, mt.colType)
        case "g" => Ref(MatrixIR.entryName, mt.entryType)
        case "global" => Ref(MatrixIR.globalName, mt.globalType)
      }

      split.tail.foreach(field => ir = GetField(ir, field))
      let = bindIR(ir)(_ => let)
    }
    let
  }

  def matrixRefStruct(mt: MatrixType, fields: String*): IR =
    MakeStruct(FastSeq("foo" -> matrixRefBoolean(mt, fields: _*)))

  def subsetTable(tt: TableType, fields: String*): TableType = {
    val rowFields = new BoxedArrayBuilder[TStruct]()
    val globalFields = new BoxedArrayBuilder[TStruct]()
    var noKey = false
    fields.foreach { f =>
      val split = f.split("\\.")
      split(0) match {
        case "row" =>
          rowFields += PruneDeadFields.subsetType(tt.rowType, split, 1).asInstanceOf[TStruct]
        case "global" =>
          globalFields += PruneDeadFields.subsetType(tt.globalType, split, 1).asInstanceOf[TStruct]
        case "NO_KEY" =>
          noKey = true
      }
    }
    val k = if (noKey) FastSeq() else tt.key
    tt.copy(
      key = k,
      rowType = PruneDeadFields.unify(
        tt.rowType,
        Array(PruneDeadFields.selectKey(tt.rowType, k)) ++ rowFields.result(): _*
      ),
      globalType = PruneDeadFields.unify(tt.globalType, globalFields.result(): _*),
    )
  }

  def subsetMatrixTable(mt: MatrixType, fields: String*): MatrixType = {
    val rowFields = new BoxedArrayBuilder[TStruct]()
    val colFields = new BoxedArrayBuilder[TStruct]()
    val entryFields = new BoxedArrayBuilder[TStruct]()
    val globalFields = new BoxedArrayBuilder[TStruct]()
    var noRowKey = false
    var noColKey = false
    fields.foreach { f =>
      val split = f.split("\\.")
      split(0) match {
        case "va" =>
          rowFields += PruneDeadFields.subsetType(mt.rowType, split, 1).asInstanceOf[TStruct]
        case "sa" =>
          colFields += PruneDeadFields.subsetType(mt.colType, split, 1).asInstanceOf[TStruct]
        case "g" =>
          entryFields += PruneDeadFields.subsetType(mt.entryType, split, 1).asInstanceOf[TStruct]
        case "global" =>
          globalFields += PruneDeadFields.subsetType(mt.globalType, split, 1).asInstanceOf[TStruct]
        case "NO_ROW_KEY" =>
          noRowKey = true
        case "NO_COL_KEY" =>
          noColKey = true
      }
    }
    val ck = if (noColKey) FastSeq() else mt.colKey
    val rk = if (noRowKey) FastSeq() else mt.rowKey
    MatrixType(
      rowKey = rk,
      colKey = ck,
      globalType = PruneDeadFields.unify(mt.globalType, globalFields.result(): _*),
      colType = PruneDeadFields.unify(
        mt.colType,
        Array(PruneDeadFields.selectKey(mt.colType, ck)) ++ colFields.result(): _*
      ),
      rowType = PruneDeadFields.unify(
        mt.rowType,
        Array(PruneDeadFields.selectKey(mt.rowType, rk)) ++ rowFields.result(): _*
      ),
      entryType = PruneDeadFields.unify(mt.entryType, entryFields.result(): _*),
    )
  }

  def mangle(t: TableIR): TableIR =
    TableRename(
      t,
      t.typ.rowType.fieldNames.map(x => x -> (x + "_")).toMap,
      t.typ.globalType.fieldNames.map(x => x -> (x + "_")).toMap,
    )

  @Test def testTableJoinMemo(): scalatest.Assertion = {
    val tk1 = TableKeyBy(tab, Array("1"))
    val tk2 = mangle(TableKeyBy(tab, Array("3")))
    val tj = TableJoin(tk1, tk2, "inner", 1)
    checkMemo(
      tj,
      subsetTable(tj.typ, "row.1", "row.4", "row.1_"),
      Array(
        subsetTable(tk1.typ, "row.1", "row.4"),
        subsetTable(tk2.typ, "row.1_", "row.3_"),
      ),
    )

    val tk3 = TableKeyBy(tab, Array("1", "2"))
    val tk4 = mangle(TableKeyBy(tab, Array("1", "2")))

    val tj2 = TableJoin(tk3, tk4, "inner", 1)
    checkMemo(
      tj2,
      subsetTable(tj2.typ, "row.3_"),
      Array(
        subsetTable(tk3.typ, "row.1", "row.2"),
        subsetTable(tk4.typ, "row.1_", "row.2_", "row.3_"),
      ),
    )

    checkMemo(
      tj2,
      subsetTable(tj2.typ, "row.3_", "NO_KEY"),
      Array(
        TableType(globalType = TStruct.empty, key = Array("1"), rowType = TStruct("1" -> TString)),
        TableType(
          globalType = TStruct.empty,
          key = Array("1_"),
          rowType = TStruct("1_" -> TString, "3_" -> TString),
        ),
      ),
    )
  }

  @Test def testTableLeftJoinRightDistinctMemo(): scalatest.Assertion = {
    val tk1 = TableKeyBy(tab, Array("1"))
    val tk2 = TableKeyBy(tab, Array("3"))
    val tj = TableLeftJoinRightDistinct(tk1, tk2, "foo")
    checkMemo(
      tj,
      subsetTable(tj.typ, "row.1", "row.4", "row.foo"),
      Array(
        subsetTable(tk1.typ, "row.1", "row.4"),
        subsetTable(tk2.typ),
      ),
    )
  }

  @Test def testTableIntervalJoinMemo(): scalatest.Assertion = {
    val tk1 = TableKeyBy(tab, Array("1"))
    val tk2 = TableKeyBy(tab, Array("3"))
    val tj = TableIntervalJoin(tk1, tk2, "foo", product = false)
    checkMemo(
      tj,
      subsetTable(tj.typ, "row.1", "row.4", "row.foo"),
      Array(
        subsetTable(tk1.typ, "row.1", "row.4"),
        subsetTable(tk2.typ),
      ),
    )
  }

  @Test def testTableMultiWayZipJoinMemo(): scalatest.Assertion = {
    val tk1 = TableKeyBy(tab, Array("1"))
    val ts = Array(tk1, tk1, tk1)
    val tmwzj = TableMultiWayZipJoin(ts, "data", "gbls")
    checkMemo(
      tmwzj,
      subsetTable(tmwzj.typ, "row.data.2", "global.gbls.g1"),
      ts.map(t => subsetTable(t.typ, "row.2", "global.g1")),
    )
  }

  @Test def testTableExplodeMemo(): scalatest.Assertion = {
    val te = TableExplode(tab, Array("2"))
    checkMemo(te, subsetTable(te.typ), Array(subsetTable(tab.typ, "row.2")))
  }

  @Test def testTableFilterMemo(): scalatest.Assertion = {
    checkMemo(
      TableFilter(tab, tableRefBoolean(tab.typ, "row.2")),
      subsetTable(tab.typ, "row.3"),
      Array(subsetTable(tab.typ, "row.2", "row.3"), null),
    )
    checkMemo(
      TableFilter(tab, False()),
      subsetTable(tab.typ, "row.1"),
      Array(subsetTable(tab.typ, "row.1"), TBoolean),
    )
  }

  @Test def testTableKeyByMemo(): scalatest.Assertion = {
    val tk = TableKeyBy(tab, Array("1"))
    checkMemo(
      tk,
      subsetTable(tk.typ, "row.2"),
      Array(subsetTable(tab.typ, "row.1", "row.2", "NO_KEY")),
    )

    val tk2 = TableKeyBy(tab, Array("3"), isSorted = true)
    checkMemo(tk2, subsetTable(tk2.typ, "row.2"), Array(subsetTable(tab.typ, "row.2")))

  }

  @Test def testTableMapRowsMemo(): scalatest.Assertion = {
    val tmr = TableMapRows(tab, tableRefStruct(tab.typ, "row.1", "row.2"))
    checkMemo(
      tmr,
      subsetTable(tmr.typ, "row.foo"),
      Array(subsetTable(tab.typ, "row.1", "row.2"), null),
    )

    val tmr2 = TableMapRows(tab, tableRefStruct(tab.typ, "row.1", "row.2"))
    checkMemo(
      tmr2,
      subsetTable(tmr2.typ, "row.foo", "NO_KEY"),
      Array(subsetTable(tab.typ, "row.1", "row.2", "NO_KEY"), null),
    )
  }

  @Test def testTableMapGlobalsMemo(): scalatest.Assertion = {
    val tmg = TableMapGlobals(tab, tableRefStruct(tab.typ.copy(key = FastSeq()), "global.g1"))
    checkMemo(
      tmg,
      subsetTable(tmg.typ, "global.foo"),
      Array(subsetTable(tab.typ, "global.g1"), null),
    )
  }

  @Test def testMatrixColsTableMemo(): scalatest.Assertion = {
    val mct = MatrixColsTable(mat)
    checkMemo(
      mct,
      subsetTable(mct.typ, "global.g1", "row.c2"),
      Array(subsetMatrixTable(mat.typ, "global.g1", "sa.c2", "NO_ROW_KEY")),
    )
  }

  @Test def testMatrixRowsTableMemo(): scalatest.Assertion = {
    val mrt = MatrixRowsTable(mat)
    checkMemo(
      mrt,
      subsetTable(mrt.typ, "global.g1", "row.r2"),
      Array(subsetMatrixTable(mat.typ, "global.g1", "va.r2", "NO_COL_KEY")),
    )
  }

  @Test def testMatrixEntriesTableMemo(): scalatest.Assertion = {
    val met = MatrixEntriesTable(mat)
    checkMemo(
      met,
      subsetTable(met.typ, "global.g1", "row.r2", "row.c2", "row.e2"),
      Array(subsetMatrixTable(mat.typ, "global.g1", "va.r2", "sa.c2", "g.e2")),
    )
  }

  @Test def testTableKeyByAndAggregateMemo(): scalatest.Assertion = {
    val tka = TableKeyByAndAggregate(
      tab,
      ApplyAggOp(PrevNonnull())(tableRefStruct(tab.typ, "row.2")),
      MakeStruct(FastSeq("bar" -> tableRefBoolean(tab.typ, "row.3"))),
      None,
      1,
    )

    checkMemo(
      tka,
      subsetTable(tka.typ, "row.foo"),
      Array(subsetTable(tab.typ, "row.2", "row.3", "NO_KEY"), null, null),
    )
    checkMemo(tka, subsetTable(tka.typ), Array(subsetTable(tab.typ, "row.3", "NO_KEY"), null, null))
  }

  @Test def testTableAggregateByKeyMemo(): scalatest.Assertion = {
    val tabk = TableAggregateByKey(
      tab,
      ApplyAggOp(PrevNonnull())(SelectFields(
        Ref(TableIR.rowName, tab.typ.rowType),
        IndexedSeq("5"),
      )),
    )
    checkMemo(
      tabk,
      requestedType = subsetTable(tabk.typ, "row.3", "row.5"),
      Array(subsetTable(tabk.typ, "row.3", "row.5"), TStruct(("5", TString))),
    )
  }

  @Test def testTableUnionMemo(): scalatest.Assertion =
    checkMemo(
      TableUnion(FastSeq(tab, tab)),
      subsetTable(tab.typ, "row.1", "global.g1"),
      Array(subsetTable(tab.typ, "row.1", "global.g1"), subsetTable(tab.typ, "row.1")),
    )

  @Test def testTableOrderByMemo(): scalatest.Assertion = {
    val tob = TableOrderBy(tab, Array(SortField("2", Ascending)))
    checkMemo(tob, subsetTable(tob.typ), Array(subsetTable(tab.typ, "row.2", "row.2.2A", "NO_KEY")))

    val tob2 = TableOrderBy(tab, Array(SortField("3", Ascending)))
    checkMemo(tob2, subsetTable(tob2.typ), Array(subsetTable(tab.typ)))
  }

  @Test def testCastMatrixToTableMemo(): scalatest.Assertion = {
    val m2t = CastMatrixToTable(mat, "__entries", "__cols")
    checkMemo(
      m2t,
      subsetTable(m2t.typ, "row.r2", "global.__cols.c2", "global.g2", "row.__entries.e2"),
      Array(subsetMatrixTable(mat.typ, "va.r2", "global.g2", "sa.c2", "g.e2", "NO_COL_KEY")),
    )
  }

  @Test def testMatrixFilterColsMemo(): scalatest.Assertion = {
    val mfc = MatrixFilterCols(mat, matrixRefBoolean(mat.typ, "global.g1", "sa.c2"))
    checkMemo(
      mfc,
      subsetMatrixTable(mfc.typ, "sa.c3"),
      Array(subsetMatrixTable(mat.typ, "global.g1", "sa.c2", "sa.c3"), null),
    )
  }

  @Test def testMatrixFilterRowsMemo(): scalatest.Assertion = {
    val mfr = MatrixFilterRows(mat, matrixRefBoolean(mat.typ, "global.g1", "va.r2"))
    checkMemo(
      mfr,
      subsetMatrixTable(mfr.typ, "sa.c3", "va.r3"),
      Array(subsetMatrixTable(mat.typ, "global.g1", "va.r2", "sa.c3", "va.r3"), null),
    )
  }

  @Test def testMatrixFilterEntriesMemo(): scalatest.Assertion = {
    val mfe =
      MatrixFilterEntries(mat, matrixRefBoolean(mat.typ, "global.g1", "va.r2", "sa.c2", "g.e2"))
    checkMemo(
      mfe,
      subsetMatrixTable(mfe.typ, "sa.c3", "va.r3"),
      Array(
        subsetMatrixTable(mat.typ, "global.g1", "va.r2", "sa.c3", "sa.c2", "va.r3", "g.e2"),
        null,
      ),
    )
  }

  @Test def testMatrixMapColsMemo(): scalatest.Assertion = {
    val mmc = MatrixMapCols(
      mat,
      ApplyAggOp(PrevNonnull())(matrixRefStruct(mat.typ, "global.g1", "sa.c2", "va.r2", "g.e2")),
      Some(FastSeq()),
    )
    checkMemo(
      mmc,
      subsetMatrixTable(mmc.typ, "va.r3", "sa.foo"),
      Array(
        subsetMatrixTable(mat.typ, "global.g1", "sa.c2", "va.r2", "g.e2", "va.r3", "NO_COL_KEY"),
        null,
      ),
    )
    val mmc2 = MatrixMapCols(
      mat,
      ApplyAggOp(PrevNonnull())(MakeStruct(FastSeq(
        "ck" -> GetField(Ref(MatrixIR.colName, mat.typ.colType), "ck"),
        "foo" -> matrixRefStruct(mat.typ, "global.g1", "sa.c2", "va.r2", "g.e2"),
      ))),
      None,
    )
    checkMemo(
      mmc2,
      subsetMatrixTable(mmc2.typ, "va.r3", "sa.foo.foo"),
      Array(subsetMatrixTable(mat.typ, "global.g1", "sa.c2", "va.r2", "g.e2", "va.r3"), null),
    )
  }

  @Test def testMatrixKeyRowsByMemo(): scalatest.Assertion = {
    val mkr = MatrixKeyRowsBy(mat, FastSeq("rk"))
    checkMemo(mkr, subsetMatrixTable(mkr.typ, "va.rk"), Array(subsetMatrixTable(mat.typ, "va.rk")))
  }

  @Test def testMatrixMapRowsMemo(): scalatest.Assertion = {
    val mmr = MatrixMapRows(
      MatrixKeyRowsBy(mat, IndexedSeq.empty),
      ApplyAggOp(PrevNonnull())(matrixRefStruct(mat.typ, "global.g1", "sa.c2", "va.r2", "g.e2")),
    )
    checkMemo(
      mmr,
      subsetMatrixTable(mmr.typ, "sa.c3", "va.foo"),
      Array(
        subsetMatrixTable(
          mat.typ.copy(rowKey = IndexedSeq.empty),
          "global.g1",
          "sa.c2",
          "va.r2",
          "g.e2",
          "sa.c3",
        ),
        null,
      ),
    )
  }

  @Test def testMatrixMapGlobalsMemo(): scalatest.Assertion = {
    val mmg = MatrixMapGlobals(mat, matrixRefStruct(mat.typ, "global.g1"))
    checkMemo(
      mmg,
      subsetMatrixTable(mmg.typ, "global.foo", "va.r3", "sa.c3"),
      Array(subsetMatrixTable(mat.typ, "global.g1", "va.r3", "sa.c3"), null),
    )
  }

  @Test def testMatrixAnnotateRowsTableMemo(): scalatest.Assertion = {
    val tl = TableLiteral(Interpret(MatrixRowsTable(mat), ctx), theHailClassLoader)
    val mart = MatrixAnnotateRowsTable(mat, tl, "foo", product = false)
    checkMemo(
      mart,
      subsetMatrixTable(mart.typ, "va.foo.r3", "va.r3"),
      Array(subsetMatrixTable(mat.typ, "va.r3"), subsetTable(tl.typ, "row.r3")),
    )
  }

  @Test def testCollectColsByKeyMemo(): scalatest.Assertion = {
    val ccbk = MatrixCollectColsByKey(mat)
    checkMemo(
      ccbk,
      subsetMatrixTable(ccbk.typ, "g.e2", "sa.c2", "NO_COL_KEY"),
      Array(subsetMatrixTable(mat.typ, "g.e2", "sa.c2")),
    )
  }

  @Test def testMatrixExplodeRowsMemo(): scalatest.Assertion = {
    val mer = MatrixExplodeRows(mat, FastSeq("r3"))
    checkMemo(
      mer,
      subsetMatrixTable(mer.typ, "va.r2"),
      Array(subsetMatrixTable(mat.typ, "va.r2", "va.r3")),
    )
  }

  @Test def testMatrixRepartitionMemo(): scalatest.Assertion = {
    checkMemo(
      MatrixRepartition(mat, 10, RepartitionStrategy.SHUFFLE),
      subsetMatrixTable(mat.typ, "va.r2", "global.g1"),
      Array(
        subsetMatrixTable(mat.typ, "va.r2", "global.g1"),
        subsetMatrixTable(mat.typ, "va.r2", "global.g1"),
      ),
    )
  }

  @Test def testMatrixUnionRowsMemo(): scalatest.Assertion = {
    checkMemo(
      MatrixUnionRows(FastSeq(mat, mat)),
      subsetMatrixTable(mat.typ, "va.r2", "global.g1"),
      Array(
        subsetMatrixTable(mat.typ, "va.r2", "global.g1"),
        subsetMatrixTable(mat.typ, "va.r2", "global.g1"),
      ),
    )
  }

  @Test def testMatrixDistinctByRowMemo(): scalatest.Assertion = {
    checkMemo(
      MatrixDistinctByRow(mat),
      subsetMatrixTable(mat.typ, "va.r2", "global.g1"),
      Array(
        subsetMatrixTable(mat.typ, "va.r2", "global.g1"),
        subsetMatrixTable(mat.typ, "va.r2", "global.g1"),
      ),
    )
  }

  @Test def testMatrixExplodeColsMemo(): scalatest.Assertion = {
    val mer = MatrixExplodeCols(mat, FastSeq("c3"))
    checkMemo(
      mer,
      subsetMatrixTable(mer.typ, "va.r2"),
      Array(subsetMatrixTable(mat.typ, "va.r2", "sa.c3")),
    )
  }

  @Test def testCastTableToMatrixMemo(): scalatest.Assertion = {
    val m2t = CastMatrixToTable(mat, "__entries", "__cols")
    val t2m = CastTableToMatrix(m2t, "__entries", "__cols", FastSeq("ck"))
    checkMemo(
      t2m,
      subsetMatrixTable(mat.typ, "va.r2", "sa.c2", "global.g2", "g.e2"),
      Array(subsetTable(
        m2t.typ,
        "row.r2",
        "global.g2",
        "global.__cols.ck",
        "global.__cols.c2",
        "row.__entries.e2",
      )),
    )
  }

  @Test def testMatrixAggregateRowsByKeyMemo(): scalatest.Assertion = {
    val magg = MatrixAggregateRowsByKey(
      mat,
      ApplyAggOp(PrevNonnull())(matrixRefStruct(mat.typ, "g.e2", "va.r2", "sa.c2")),
      ApplyAggOp(PrevNonnull())(matrixRefStruct(mat.typ, "va.r3", "global.g1")),
    )
    checkMemo(
      magg,
      subsetMatrixTable(magg.typ, "sa.c3", "g.foo", "va.foo"),
      Array(
        subsetMatrixTable(mat.typ, "sa.c3", "g.e2", "va.r2", "sa.c2", "global.g1", "va.r3"),
        null,
        null,
      ),
    )
  }

  @Test def testMatrixAggregateColsByKeyMemo(): scalatest.Assertion = {
    val magg = MatrixAggregateColsByKey(
      mat,
      ApplyAggOp(PrevNonnull())(matrixRefStruct(mat.typ, "g.e2", "va.r2", "sa.c2")),
      ApplyAggOp(PrevNonnull())(matrixRefStruct(mat.typ, "sa.c3", "global.g1")),
    )
    checkMemo(
      magg,
      subsetMatrixTable(magg.typ, "va.r3", "g.foo", "sa.foo"),
      Array(
        subsetMatrixTable(mat.typ, "sa.c2", "va.r2", "va.r3", "g.e2", "global.g1", "sa.c3"),
        null,
        null,
      ),
    )
  }

  val ref = Ref(freshName(), TStruct("a" -> TInt32, "b" -> TInt32, "c" -> TInt32))
  val refEnv = BindingEnv(Env(ref.name -> ref.typ))
  val arr = MakeArray(FastSeq(ref, ref), TArray(ref.typ))
  val st = MakeStream(FastSeq(ref, ref), TStream(ref.typ))
  val ndArr = MakeNDArray(arr, MakeTuple(IndexedSeq((0, I64(2L)))), True(), ErrorIDs.NO_ERROR)
  val empty = TStruct.empty
  val justA = TStruct("a" -> TInt32)
  val justB = TStruct("b" -> TInt32)
  val aAndB = TStruct("a" -> TInt32, "b" -> TInt32)
  val bAndA = TStruct("b" -> TInt32, "a" -> TInt32)
  val justARequired = TStruct("a" -> TInt32)
  val justBRequired = TStruct("b" -> TInt32)

  @Test def testIfMemo(): scalatest.Assertion =
    checkMemo(If(True(), ref, ref), justA, Array(TBoolean, justA, justA), refEnv)

  @Test def testSwitchMemo(): scalatest.Assertion =
    checkMemo(
      Switch(I32(0), ref, FastSeq(ref)),
      justA,
      Array(TInt32, justA, justA),
      refEnv,
    )

  @Test def testCoalesceMemo(): scalatest.Assertion =
    checkMemo(Coalesce(FastSeq(ref, ref)), justA, Array(justA, justA), refEnv)

  @Test def testLetMemo(): scalatest.Assertion = {
    checkMemo(bindIR(ref)(x => x), justA, Array(justA, null), refEnv)
    checkMemo(bindIR(ref)(_ => True()), TBoolean, Array(empty, null), refEnv)
  }

  @Test def testAggLetMemo(): scalatest.Assertion = {
    val env = BindingEnv.empty.createAgg.bindAgg(ref.name -> ref.typ)
    checkMemo(
      aggBindIR(ref)(foo => ApplyAggOp(Collect())(SelectFields(foo, IndexedSeq("a")))),
      TArray(justA),
      Array(justA, null),
      env,
    )
    checkMemo(aggBindIR(ref)(_ => True()), TBoolean, Array(empty, null), env)
  }

  @Test def testMakeArrayMemo(): scalatest.Assertion =
    checkMemo(arr, TArray(justB), Array(justB, justB), refEnv)

  @Test def testArrayRefMemo(): scalatest.Assertion =
    checkMemo(ArrayRef(arr, I32(0)), justB, Array(TArray(justB), null, null), refEnv)

  @Test def testArrayLenMemo(): scalatest.Assertion =
    checkMemo(ArrayLen(arr), TInt32, Array(TArray(empty)), refEnv)

  @Test def testStreamTakeMemo(): scalatest.Assertion =
    checkMemo(StreamTake(st, I32(2)), TStream(justA), Array(TStream(justA), null), refEnv)

  @Test def testStreamDropMemo(): scalatest.Assertion =
    checkMemo(StreamDrop(st, I32(2)), TStream(justA), Array(TStream(justA), null), refEnv)

  @Test def testStreamMapMemo(): scalatest.Assertion =
    checkMemo(
      mapIR(st)(x => x),
      TStream(justB),
      Array(TStream(justB), null),
      refEnv,
    )

  @Test def testStreamGroupedMemo(): scalatest.Assertion =
    checkMemo(
      StreamGrouped(st, I32(2)),
      TStream(TStream(justB)),
      Array(TStream(justB), null),
      refEnv,
    )

  @Test def testStreamGroupByKeyMemo(): scalatest.Assertion =
    checkMemo(
      StreamGroupByKey(st, FastSeq("a"), false),
      TStream(TStream(justB)),
      Array(TStream(TStruct("a" -> TInt32, "b" -> TInt32)), null),
      refEnv,
    )

  @Test def testStreamMergeMemo(): scalatest.Assertion = {
    val st2 = st.deepCopy()
    checkMemo(
      StreamMultiMerge(
        IndexedSeq(st, st2),
        FastSeq("a"),
      ),
      TStream(justB),
      Array(TStream(aAndB), TStream(aAndB)),
      refEnv,
    )
  }

  @Test def testStreamZipMemo(): scalatest.Assertion = {
    val a2 = st.deepCopy()
    val a3 = st.deepCopy()
    for (
      b <- Array(
        ArrayZipBehavior.ExtendNA,
        ArrayZipBehavior.TakeMinLength,
        ArrayZipBehavior.AssertSameLength,
      )
    ) {
      checkMemo(
        zipIR(FastSeq(st, a2, a3), b) { case Seq(foo, bar, _) =>
          bindIRs(GetField(foo, "b"), GetField(bar, "a"))(_ => False())
        },
        TStream(TBoolean),
        Array(TStream(justB), TStream(justA), TStream(empty), null),
        refEnv,
      )
    }

    checkMemo(
      zipIR(
        FastSeq(st, a2, a3),
        ArrayZipBehavior.AssumeSameLength,
      ) { case Seq(foo, bar, _) =>
        bindIRs(GetField(foo, "b"), GetField(bar, "a"))(_ => False())
      },
      TStream(TBoolean),
      Array(TStream(justB), TStream(justA), null, null),
      refEnv,
    )
  }

  @Test def testStreamFilterMemo(): scalatest.Assertion = {
    checkMemo(
      filterIR(st)(foo => bindIR(GetField(foo, "b"))(_ => False())),
      TStream(empty),
      Array(TStream(justB), null),
      refEnv,
    )
    checkMemo(filterIR(st)(_ => False()), TStream(empty), Array(TStream(empty), null), refEnv)
    checkMemo(filterIR(st)(_ => False()), TStream(justB), Array(TStream(justB), null), refEnv)
  }

  @Test def testStreamFlatMapMemo(): scalatest.Assertion =
    checkMemo(
      flatMapIR(st)(foo => MakeStream(FastSeq(foo), TStream(ref.typ))),
      TStream(justA),
      Array(TStream(justA), null),
      refEnv,
    )

  @Test def testStreamFoldMemo(): scalatest.Assertion =
    checkMemo(
      foldIR(st, I32(0))((_, foo) => GetField(foo, "a")),
      TInt32,
      Array(TStream(justA), null, null),
      refEnv,
    )

  @Test def testStreamScanMemo(): scalatest.Assertion =
    checkMemo(
      streamScanIR(st, I32(0))((_, foo) => GetField(foo, "a")),
      TStream(TInt32),
      Array(TStream(justA), null, null),
      refEnv,
    )

  @Test def testStreamJoinRightDistinct(): scalatest.Assertion = {
    checkMemo(
      joinRightDistinctIR(
        st,
        st,
        FastSeq("a"),
        FastSeq("a"),
        "left",
      ) { (l, r) =>
        MakeStruct(FastSeq(
          "a" -> GetField(l, "a"),
          "b" -> GetField(l, "b"),
          "c" -> GetField(l, "c"),
          "d" -> GetField(r, "b"),
          "e" -> GetField(r, "c"),
        ))
      },
      TStream(TStruct("b" -> TInt32, "d" -> TInt32)),
      Array(
        TStream(TStruct("a" -> TInt32, "b" -> TInt32)),
        TStream(TStruct("a" -> TInt32, "b" -> TInt32)),
        TStruct("b" -> TInt32, "d" -> TInt32),
      ),
      refEnv,
    )
  }

  @Test def testStreamLeftIntervalJoin(): scalatest.Assertion = {
    val leftElemType = TStruct("a" -> TInt32, "b" -> TInt32, "c" -> TInt32)
    val rightElemType = TStruct("interval" -> TInterval(TInt32), "ignored" -> TInt32)

    val lname = Ref(freshName(), leftElemType)
    val rname = Ref(freshName(), TArray(rightElemType))
    val join =
      StreamLeftIntervalJoin(
        MakeStream(FastSeq(), TStream(leftElemType)),
        MakeStream(FastSeq(), TStream(rightElemType)),
        leftElemType.fieldNames.head,
        "interval",
        lname.name,
        rname.name,
        InsertFields(lname, FastSeq("intervals" -> rname)),
      )

    val prunedLElemType = leftElemType.deleteKey("b")
    val prunedRElemType = rightElemType.deleteKey("ignored")
    val requestedElemType = prunedLElemType.insertFields(
      FastSeq("intervals" -> TArray(prunedRElemType))
    )

    checkMemo(
      join,
      TStream(requestedElemType),
      Array(
        TStream(prunedLElemType),
        TStream(prunedRElemType),
        requestedElemType,
      ),
    )

    checkRebuild[StreamLeftIntervalJoin](
      join,
      TStream(requestedElemType),
      (_, pruned) =>
        pruned.left.typ == TStream(prunedLElemType) &&
          pruned.right.typ == TStream(prunedRElemType) &&
          pruned.body.typ == requestedElemType,
    )
  }

  @Test def testStreamForMemo(): scalatest.Assertion = {
    checkMemo(
      forIR(st)(foo => Die(invoke("str", TString, GetField(foo, "a")), TVoid, ErrorIDs.NO_ERROR)),
      TVoid,
      Array(TStream(justA), null),
      refEnv,
    )
  }

  @Test def testMakeNDArrayMemo(): scalatest.Assertion = {
    val x = Ref(freshName(), TArray(TStruct("a" -> TInt32, "b" -> TInt64)))
    val y = Ref(freshName(), TTuple(TInt64, TInt64))
    checkMemo(
      MakeNDArray(x, y, True(), ErrorIDs.NO_ERROR),
      TNDArray(TStruct("a" -> TInt32), Nat(2)),
      Array(
        TArray(TStruct("a" -> TInt32)),
        TTuple(TInt64, TInt64),
        TBoolean,
      ),
      BindingEnv.empty.bindEval(x.name -> x.typ, y.name -> y.typ),
    )
  }

  @Test def testNDArrayMapMemo(): scalatest.Assertion =
    checkMemo(
      ndMap(ndArr)(x => x),
      TNDArray(justBRequired, Nat(1)),
      Array(TNDArray(justBRequired, Nat(1)), null),
      refEnv,
    )

  @Test def testNDArrayMap2Memo(): scalatest.Assertion = {
    checkMemo(
      ndMap2(ndArr, ndArr)((l, _) => l),
      TNDArray(justBRequired, Nat(1)),
      Array(TNDArray(justBRequired, Nat(1)), TNDArray(TStruct.empty, Nat(1)), null),
      refEnv,
    )
    checkMemo(
      ndMap2(ndArr, ndArr)((_, r) => r),
      TNDArray(justBRequired, Nat(1)),
      Array(TNDArray(TStruct.empty, Nat(1)), TNDArray(justBRequired, Nat(1)), null),
      refEnv,
    )
    checkMemo(
      ndMap2(ndArr, ndArr) { (l, r) =>
        ApplyBinaryPrimOp(Add(), GetField(l, "a"), GetField(r, "b"))
      },
      TNDArray(TInt32, Nat(1)),
      Array(TNDArray(justARequired, Nat(1)), TNDArray(justBRequired, Nat(1)), null),
      refEnv,
    )
  }

  @Test def testMakeStructMemo(): scalatest.Assertion = {
    checkMemo(
      MakeStruct(IndexedSeq("a" -> ref, "b" -> I32(10))),
      TStruct("a" -> justA),
      Array(justA, null),
      refEnv,
    )
    checkMemo(
      MakeStruct(IndexedSeq("a" -> ref, "b" -> I32(10))),
      TStruct.empty,
      Array(null, null),
      refEnv,
    )
  }

  @Test def testInsertFieldsMemo(): scalatest.Assertion =
    checkMemo(
      InsertFields(ref, IndexedSeq("d" -> ref)),
      justA ++ TStruct("d" -> justB),
      Array(justA, justB),
      refEnv,
    )

  @Test def testSelectFieldsMemo(): scalatest.Assertion = {
    checkMemo(SelectFields(ref, IndexedSeq("a", "b")), justA, Array(justA), refEnv)
    checkMemo(SelectFields(ref, IndexedSeq("b", "a")), bAndA, Array(aAndB), refEnv)
  }

  @Test def testGetFieldMemo(): scalatest.Assertion =
    checkMemo(GetField(ref, "a"), TInt32, Array(justA), refEnv)

  @Test def testMakeTupleMemo(): scalatest.Assertion =
    checkMemo(MakeTuple(IndexedSeq(0 -> ref)), TTuple(justA), Array(justA), refEnv)

  @Test def testGetTupleElementMemo(): scalatest.Assertion =
    checkMemo(
      GetTupleElement(MakeTuple.ordered(IndexedSeq(ref, ref)), 1),
      justB,
      Array(TTuple(FastSeq(TupleField(1, justB)))),
      refEnv,
    )

  @Test def testCastRenameMemo(): scalatest.Assertion = {
    val x = Ref(freshName(), TArray(TStruct("x" -> TInt32, "y" -> TString)))
    checkMemo(
      CastRename(x, TArray(TStruct("y" -> TInt32, "z" -> TString))),
      TArray(TStruct("z" -> TString)),
      Array(TArray(TStruct("y" -> TString))),
      BindingEnv.empty.bindEval(x.name -> x.typ),
    )
  }

  @Test def testAggFilterMemo(): scalatest.Assertion = {
    val t = TStruct("a" -> TInt32, "b" -> TInt64, "c" -> TString)
    val x = Ref(freshName(), t)
    val select = SelectFields(x, IndexedSeq("c"))
    checkMemo(
      AggFilter(
        ApplyComparisonOp(LT(TInt32, TInt32), GetField(x, "a"), I32(0)),
        ApplyAggOp(
          FastSeq(),
          FastSeq(select),
          AggSignature(Collect(), FastSeq(), FastSeq(select.typ)),
        ),
        false,
      ),
      TArray(TStruct("c" -> TString)),
      Array(null, TArray(TStruct("c" -> TString))),
      BindingEnv.empty.createAgg.bindAgg(x.name -> t),
    )
  }

  @Test def testAggExplodeMemo(): scalatest.Assertion = {
    val t = TStream(TStruct("a" -> TInt32, "b" -> TInt64))
    val x = Ref(freshName(), t)
    checkMemo(
      aggExplodeIR(x) { foo =>
        val select = SelectFields(foo, IndexedSeq("a"))
        ApplyAggOp(
          FastSeq(),
          FastSeq(select),
          AggSignature(Collect(), FastSeq(), FastSeq(select.typ)),
        )
      },
      TArray(TStruct("a" -> TInt32)),
      Array(TStream(TStruct("a" -> TInt32)), TArray(TStruct("a" -> TInt32))),
      BindingEnv.empty.createAgg.bindAgg(x.name -> t),
    )
  }

  @Test def testAggArrayPerElementMemo(): scalatest.Assertion = {
    val t = TArray(TStruct("a" -> TInt32, "b" -> TInt64))
    val x = Ref(freshName(), t)
    checkMemo(
      aggArrayPerElement(x) { (foo, _) =>
        val select = SelectFields(foo, IndexedSeq("a"))
        ApplyAggOp(
          FastSeq(),
          FastSeq(select),
          AggSignature(Collect(), FastSeq(), FastSeq(select.typ)),
        )
      },
      TArray(TArray(TStruct("a" -> TInt32))),
      Array(TArray(TStruct("a" -> TInt32)), TArray(TStruct("a" -> TInt32))),
      BindingEnv.empty.createAgg.bindAgg(x.name -> t),
    )
  }

  @Test def testCDAMemo(): scalatest.Assertion = {
    val ctxT = TStruct("a" -> TInt32, "b" -> TString)
    val globT = TStruct("c" -> TInt64, "d" -> TFloat64)
    val x = cdaIR(NA(TStream(ctxT)), NA(globT), "test", NA(TString)) { (ctx, glob) =>
      MakeTuple.ordered(FastSeq(ctx, glob))
    }

    checkMemo(
      x,
      TArray(TTuple(ctxT.typeAfterSelectNames(Array("a")), globT.typeAfterSelectNames(Array("c")))),
      Array(
        TStream(ctxT.typeAfterSelectNames(Array("a"))),
        globT.typeAfterSelectNames(Array("c")),
        null,
        TString,
      ),
    )
  }

  @Test def testTableCountMemo(): scalatest.Assertion =
    checkMemo(TableCount(tab), TInt64, Array(subsetTable(tab.typ, "NO_KEY")))

  @Test def testTableGetGlobalsMemo(): scalatest.Assertion =
    checkMemo(
      TableGetGlobals(tab),
      TStruct("g1" -> TInt32),
      Array(subsetTable(tab.typ, "global.g1", "NO_KEY")),
    )

  @Test def testTableCollectMemo(): scalatest.Assertion =
    checkMemo(
      TableCollect(TableKeyBy(tab, FastSeq())),
      TStruct("rows" -> TArray(TStruct("3" -> TString)), "global" -> TStruct("g2" -> TInt32)),
      Array(subsetTable(tab.typ.copy(key = FastSeq()), "row.3", "global.g2")),
    )

  @Test def testTableHeadMemo(): scalatest.Assertion =
    checkMemo(
      TableHead(tab, 10L),
      subsetTable(tab.typ.copy(key = FastSeq()), "global.g1"),
      Array(subsetTable(tab.typ, "row.3", "global.g1")),
    )

  @Test def testTableTailMemo(): scalatest.Assertion =
    checkMemo(
      TableTail(tab, 10L),
      subsetTable(tab.typ.copy(key = FastSeq()), "global.g1"),
      Array(subsetTable(tab.typ, "row.3", "global.g1")),
    )

  @Test def testTableToValueApplyMemo(): scalatest.Assertion =
    checkMemo(
      TableToValueApply(tab, ForceCountTable()),
      TInt64,
      Array(tab.typ),
    )

  @Test def testMatrixToValueApplyMemo(): scalatest.Assertion =
    checkMemo(
      MatrixToValueApply(mat, ForceCountMatrixTable()),
      TInt64,
      Array(mat.typ),
    )

  @Test def testTableAggregateMemo(): scalatest.Assertion =
    checkMemo(
      TableAggregate(tab, tableRefBoolean(tab.typ, "global.g1")),
      TBoolean,
      Array(subsetTable(tab.typ, "global.g1"), null),
    )

  @Test def testMatrixAggregateMemo(): scalatest.Assertion =
    checkMemo(
      MatrixAggregate(mat, matrixRefBoolean(mat.typ, "global.g1")),
      TBoolean,
      Array(subsetMatrixTable(mat.typ, "global.g1", "NO_COL_KEY"), null),
    )

  @Test def testPipelineLetMemo(): scalatest.Assertion = {
    val t = TStruct("a" -> TInt32)
    checkMemo(
      relationalBindIR(NA(t))(x => x),
      TStruct.empty,
      Array(TStruct.empty, TStruct.empty),
    )
  }

  @Test def testTableFilterRebuild(): scalatest.Assertion = {
    checkRebuild(
      TableFilter(tr, tableRefBoolean(tr.typ, "row.2")),
      subsetTable(tr.typ, "row.3"),
      (_: BaseIR, r: BaseIR) => {
        val tf = r.asInstanceOf[TableFilter]
        TypeCheck(ctx, tf.pred, PruneDeadFields.relationalTypeToEnv(tf.typ))
        tf.child.typ == subsetTable(tr.typ, "row.3", "row.2")
      },
    )
  }

  @Test def testTableMapRowsRebuild(): scalatest.Assertion = {
    val tmr = TableMapRows(tr, tableRefStruct(tr.typ, "row.2", "global.g1"))
    checkRebuild(
      tmr,
      subsetTable(tmr.typ, "row.foo"),
      (_: BaseIR, r: BaseIR) => {
        val tmr = r.asInstanceOf[TableMapRows]
        TypeCheck(ctx, tmr.newRow, PruneDeadFields.relationalTypeToEnv(tmr.child.typ))
        tmr.child.typ == subsetTable(tr.typ, "row.2", "global.g1", "row.3")
      },
    )

    val tmr2 = TableMapRows(tr, tableRefStruct(tr.typ, "row.2", "global.g1"))
    checkRebuild(
      tmr2,
      subsetTable(tmr2.typ, "row.foo", "NO_KEY"),
      (_: BaseIR, r: BaseIR) => {
        val tmr = r.asInstanceOf[TableMapRows]
        TypeCheck(ctx, tmr.newRow, PruneDeadFields.relationalTypeToEnv(tmr.child.typ))
        tmr.child.typ == subsetTable(
          tr.typ,
          "row.2",
          "global.g1",
          "row.3",
          "NO_KEY",
        ) // FIXME: remove row.3 when TableRead is fixed
      },
    )

  }

  @Test def testTableMapGlobalsRebuild(): scalatest.Assertion = {
    val tmg = TableMapGlobals(tr, tableRefStruct(tr.typ.copy(key = FastSeq()), "global.g1"))
    checkRebuild(
      tmg,
      subsetTable(tmg.typ, "global.foo"),
      (_: BaseIR, r: BaseIR) => {
        val tmg = r.asInstanceOf[TableMapGlobals]
        TypeCheck(ctx, tmg.newGlobals, PruneDeadFields.relationalTypeToEnv(tmg.child.typ))
        tmg.child.typ == subsetTable(tr.typ, "global.g1")
      },
    )
  }

  @Test def testTableLeftJoinRightDistinctRebuild(): scalatest.Assertion = {
    val tk1 = TableKeyBy(tab, Array("1"))
    val tk2 = TableKeyBy(tab, Array("3"))
    val tj = TableLeftJoinRightDistinct(tk1, tk2, "foo")

    checkRebuild(
      tj,
      subsetTable(tj.typ, "row.1", "row.4"),
      (_: BaseIR, r: BaseIR) =>
        r.isInstanceOf[TableKeyBy], // no dependence on row.foo elides the join
    )
  }

  @Test def testTableIntervalJoinRebuild(): scalatest.Assertion = {
    val tk1 = TableKeyBy(tab, Array("1"))
    val tk2 = TableKeyBy(tab, Array("3"))
    val tj = TableIntervalJoin(tk1, tk2, "foo", product = false)

    checkRebuild(
      tj,
      subsetTable(tj.typ, "row.1", "row.4"),
      (_: BaseIR, r: BaseIR) =>
        r.isInstanceOf[TableKeyBy], // no dependence on row.foo elides the join
    )
  }

  @Test def testTableUnionRebuildUnifiesRowTypes(): scalatest.Assertion = {
    val mapExpr = InsertFields(
      Ref(TableIR.rowName, tr.typ.rowType),
      FastSeq("foo" -> tableRefBoolean(tr.typ, "row.3", "global.g1")),
    )
    val tmap = TableMapRows(tr, mapExpr)
    val tfilter = TableFilter(
      tmap,
      tableRefBoolean(tmap.typ, "row.2"),
    )
    val tunion = TableUnion(FastSeq(tfilter, tmap))
    checkRebuild(
      tunion,
      subsetTable(tunion.typ, "row.foo"),
      (_: BaseIR, rebuilt: BaseIR) => {
        val tu = rebuilt.asInstanceOf[TableUnion]
        val tf = tu.childrenSeq(0)
        val tm = tu.childrenSeq(1)
        tf.typ.rowType == tm.typ.rowType &&
        tu.typ == subsetTable(tunion.typ, "row.foo", "global.g1")
      },
    )
  }

  @Test def testTableMultiWayZipJoinRebuildUnifiesRowTypes(): scalatest.Assertion = {
    val t1 = TableKeyBy(tab, Array("1"))
    val t2 = TableFilter(t1, tableRefBoolean(t1.typ, "row.2"))
    val t3 = TableFilter(t1, tableRefBoolean(t1.typ, "row.3"))
    val ts = Array(t1, t2, t3)
    val tmwzj = TableMultiWayZipJoin(ts, "data", "gbls")
    val childRType = subsetTable(t1.typ, "row.2", "global.g1")
    checkRebuild(
      tmwzj,
      subsetTable(tmwzj.typ, "row.data.2", "global.gbls.g1"),
      (_: BaseIR, rebuilt: BaseIR) => {
        val t = rebuilt.asInstanceOf[TableMultiWayZipJoin]
        t.childrenSeq.forall(c => c.typ == childRType)
      },
    )
  }

  @Test def testMatrixFilterColsRebuild(): scalatest.Assertion = {
    val mfc = MatrixFilterCols(mr, matrixRefBoolean(mr.typ, "sa.c2"))
    checkRebuild(
      mfc,
      subsetMatrixTable(mfc.typ, "global.g1"),
      (_: BaseIR, r: BaseIR) => {
        val mfc = r.asInstanceOf[MatrixFilterCols]
        TypeCheck(ctx, mfc.pred, PruneDeadFields.relationalTypeToEnv(mfc.child.typ))
        mfc.child.asInstanceOf[MatrixRead].typ == subsetMatrixTable(mr.typ, "global.g1", "sa.c2")
      },
    )
  }

  @Test def testMatrixFilterEntriesRebuild(): scalatest.Assertion = {
    val mfe = MatrixFilterEntries(mr, matrixRefBoolean(mr.typ, "sa.c2", "va.r2", "g.e1"))
    checkRebuild(
      mfe,
      subsetMatrixTable(mfe.typ, "global.g1"),
      (_: BaseIR, r: BaseIR) => {
        val mfe = r.asInstanceOf[MatrixFilterEntries]
        TypeCheck(ctx, mfe.pred, PruneDeadFields.relationalTypeToEnv(mfe.child.typ))
        mfe.child.asInstanceOf[MatrixRead].typ == subsetMatrixTable(
          mr.typ,
          "global.g1",
          "sa.c2",
          "va.r2",
          "g.e1",
        )
      },
    )
  }

  @Test def testMatrixMapRowsRebuild(): scalatest.Assertion = {
    val mmr = MatrixMapRows(
      MatrixKeyRowsBy(mr, IndexedSeq.empty),
      matrixRefStruct(mr.typ, "va.r2"),
    )
    checkRebuild(
      mmr,
      subsetMatrixTable(mmr.typ, "global.g1", "g.e1", "va.foo"),
      (_: BaseIR, r: BaseIR) => {
        val mmr = r.asInstanceOf[MatrixMapRows]
        TypeCheck(ctx, mmr.newRow, PruneDeadFields.relationalTypeToEnv(mmr.child.typ))
        mmr.child.asInstanceOf[MatrixKeyRowsBy].child.asInstanceOf[
          MatrixRead
        ].typ == subsetMatrixTable(mr.typ, "global.g1", "va.r2", "g.e1")
      },
    )
  }

  @Test def testMatrixMapColsRebuild(): scalatest.Assertion = {
    val mmc = MatrixMapCols(mr, matrixRefStruct(mr.typ, "sa.c2"), Some(FastSeq("foo")))
    checkRebuild(
      mmc,
      subsetMatrixTable(mmc.typ, "global.g1", "g.e1", "sa.foo"),
      (_: BaseIR, r: BaseIR) => {
        val mmc = r.asInstanceOf[MatrixMapCols]
        TypeCheck(ctx, mmc.newCol, PruneDeadFields.relationalTypeToEnv(mmc.child.typ))
        mmc.child.asInstanceOf[MatrixRead].typ == subsetMatrixTable(
          mr.typ,
          "global.g1",
          "sa.c2",
          "g.e1",
        )
      },
    )
  }

  @Test def testMatrixMapEntriesRebuild(): scalatest.Assertion = {
    val mme = MatrixMapEntries(mr, matrixRefStruct(mr.typ, "sa.c2", "va.r2"))
    checkRebuild(
      mme,
      subsetMatrixTable(mme.typ, "global.g1", "g.foo"),
      (_: BaseIR, r: BaseIR) => {
        val mme = r.asInstanceOf[MatrixMapEntries]
        TypeCheck(ctx, mme.newEntries, PruneDeadFields.relationalTypeToEnv(mme.child.typ))
        mme.child.asInstanceOf[MatrixRead].typ == subsetMatrixTable(
          mr.typ,
          "global.g1",
          "sa.c2",
          "va.r2",
        )
      },
    )
  }

  @Test def testMatrixMapGlobalsRebuild(): scalatest.Assertion = {
    val mmg = MatrixMapGlobals(mr, matrixRefStruct(mr.typ, "global.g1"))
    checkRebuild(
      mmg,
      subsetMatrixTable(mmg.typ, "global.foo", "g.e1", "va.r2"),
      (_: BaseIR, r: BaseIR) => {
        val mmg = r.asInstanceOf[MatrixMapGlobals]
        TypeCheck(ctx, mmg.newGlobals, PruneDeadFields.relationalTypeToEnv(mmg.child.typ))
        mmg.child.asInstanceOf[MatrixRead].typ == subsetMatrixTable(
          mr.typ,
          "global.g1",
          "va.r2",
          "g.e1",
        )
      },
    )
  }

  @Test def testMatrixAggregateRowsByKeyRebuild(): scalatest.Assertion = {
    val ma = MatrixAggregateRowsByKey(
      mr,
      matrixRefStruct(mr.typ, "sa.c2"),
      matrixRefStruct(mr.typ, "global.g1"),
    )
    checkRebuild(
      ma,
      subsetMatrixTable(ma.typ, "va.foo", "g.foo"),
      (_: BaseIR, r: BaseIR) => {
        val ma = r.asInstanceOf[MatrixAggregateRowsByKey]
        TypeCheck(ctx, ma.entryExpr, PruneDeadFields.relationalTypeToEnv(ma.child.typ))
        ma.child.asInstanceOf[MatrixRead].typ == subsetMatrixTable(mr.typ, "global.g1", "sa.c2")
      },
    )
  }

  @Test def testMatrixAggregateColsByKeyRebuild(): scalatest.Assertion = {
    val ma = MatrixAggregateColsByKey(
      mr,
      matrixRefStruct(mr.typ, "va.r2"),
      matrixRefStruct(mr.typ, "global.g1"),
    )
    checkRebuild(
      ma,
      subsetMatrixTable(ma.typ, "g.foo", "sa.foo"),
      (_: BaseIR, r: BaseIR) => {
        val ma = r.asInstanceOf[MatrixAggregateColsByKey]
        TypeCheck(ctx, ma.entryExpr, PruneDeadFields.relationalTypeToEnv(ma.child.typ))
        ma.child.asInstanceOf[MatrixRead].typ == subsetMatrixTable(mr.typ, "global.g1", "va.r2")
      },
    )
  }

  @Test def testMatrixUnionRowsRebuild(): scalatest.Assertion = {
    val mat2 = MatrixLiteral(mType.copy(colKey = FastSeq()), mat.tl)
    checkRebuild(
      MatrixUnionRows(FastSeq(
        mat,
        MatrixMapCols(mat2, Ref(MatrixIR.colName, mat2.typ.colType), Some(FastSeq("ck"))),
      )),
      mat.typ.copy(colKey = FastSeq()),
      (_: BaseIR, r: BaseIR) =>
        r.asInstanceOf[MatrixUnionRows].childrenSeq.forall {
          _.typ.colKey.isEmpty
        },
    )
  }

  @Test def testMatrixUnionColsRebuild(): scalatest.Assertion = {
    def getColField(name: String) =
      GetField(Ref(MatrixIR.colName, mat.typ.colType), name)
    def childrenMatch(matrixUnionCols: MatrixUnionCols): Boolean =
      matrixUnionCols.left.typ.colType == matrixUnionCols.right.typ.colType &&
        matrixUnionCols.left.typ.entryType == matrixUnionCols.right.typ.entryType

    val wrappedMat = MatrixMapCols(
      mat,
      MakeStruct(IndexedSeq(
        ("ck", getColField("ck")),
        ("c2", getColField("c2")),
        ("c3", getColField("c3")),
      )),
      Some(FastSeq("ck")),
    )

    val wrappedMat2 = MatrixRename(
      wrappedMat,
      Map.empty,
      Map.empty,
      wrappedMat.typ.rowType.fieldNames.map(x => x -> (if (x == "rk") x else x + "_")).toMap,
      Map.empty,
    )

    val mucBothSame = MatrixUnionCols(wrappedMat, wrappedMat2, "inner")
    checkRebuild(mucBothSame, mucBothSame.typ)
    checkRebuild[MatrixUnionCols](
      mucBothSame,
      mucBothSame.typ.copy(colType = TStruct(("ck", TString), ("c2", TInt32))),
      (old, rebuilt) =>
        (old.typ.rowType == rebuilt.typ.rowType) &&
          (old.typ.globalType == rebuilt.typ.globalType) &&
          (rebuilt.typ.colType.fieldNames.toIndexedSeq == IndexedSeq("ck", "c2")) &&
          childrenMatch(rebuilt),
    )

    /* Since `mat` is a MatrixLiteral, it won't be rebuilt, will keep all fields. But wrappedMat is
     * a MatrixMapCols, so it will drop */
    /* unrequested fields. This test would fail without upcasting in the MatrixUnionCols rebuild
     * rule. */
    val muc2 = MatrixUnionCols(mat, wrappedMat2, "inner")
    checkRebuild[MatrixUnionCols](
      muc2,
      muc2.typ.copy(colType = TStruct(("ck", TString))),
      (old, rebuilt) =>
        childrenMatch(rebuilt),
    )

  }

  @Test def testMatrixAnnotateRowsTableRebuild(): scalatest.Assertion = {
    val tl = TableLiteral(Interpret(MatrixRowsTable(mat), ctx), theHailClassLoader)
    val mart = MatrixAnnotateRowsTable(mat, tl, "foo", product = false)
    checkRebuild(
      mart,
      subsetMatrixTable(mart.typ),
      (_: BaseIR, r: BaseIR) =>
        r.isInstanceOf[MatrixLiteral],
    )
  }

  val ts = TStruct(
    "a" -> TInt32,
    "b" -> TInt64,
    "c" -> TString,
  )

  def subsetTS(fields: String*): TStruct = ts.filterSet(fields.toSet)._1

  @Test def testNARebuild(): scalatest.Assertion = {
    checkRebuild(
      NA(ts),
      subsetTS("b"),
      (_: BaseIR, r: BaseIR) => {
        val na = r.asInstanceOf[NA]
        na.typ == subsetTS("b")
      },
    )
  }

  @Test def testIfRebuild(): scalatest.Assertion = {
    checkRebuild(
      If(True(), NA(ts), NA(ts)),
      subsetTS("b"),
      (_: BaseIR, r: BaseIR) => {
        val ir = r.asInstanceOf[If]
        ir.cnsq.typ == subsetTS("b") && ir.altr.typ == subsetTS("b")
      },
    )
  }

  @Test def testSwitchRebuild(): scalatest.Assertion =
    checkRebuild[IR](
      Switch(I32(0), NA(ts), FastSeq(NA(ts))),
      subsetTS("b"),
      {
        case (_, Switch(_, default, cases)) =>
          default.typ == subsetTS("b") &&
          cases(0).typ == subsetTS("b")
      },
    )

  @Test def testCoalesceRebuild(): scalatest.Assertion = {
    checkRebuild(
      Coalesce(FastSeq(NA(ts), NA(ts))),
      subsetTS("b"),
      (_: BaseIR, r: BaseIR) =>
        r.children.forall(_.typ == subsetTS("b")),
    )
  }

  @Test def testLetRebuild(): scalatest.Assertion = {
    checkRebuild(
      bindIR(NA(ts))(x => x),
      subsetTS("b"),
      (_: BaseIR, r: BaseIR) => {
        val ir = r.asInstanceOf[Block]
        ir.bindings.head.value.typ == subsetTS("b")
      },
    )
  }

  @Test def testAggLetRebuild(): scalatest.Assertion = {
    checkRebuild(
      aggBindIR(NA(ref.typ))(foo => ApplyAggOp(Collect())(SelectFields(foo, IndexedSeq("a")))),
      TArray(subsetTS("a")),
      (_: BaseIR, r: BaseIR) =>
        r match {
          case Block(Seq(Binding(_, value, Scope.AGG)), _) =>
            value.typ == subsetTS("a")
        },
      BindingEnv.empty.createAgg,
    )
  }

  @Test def testMakeArrayRebuild(): scalatest.Assertion = {
    checkRebuild(
      MakeArray(IndexedSeq(NA(ts)), TArray(ts)),
      TArray(subsetTS("b")),
      (_: BaseIR, r: BaseIR) => {
        val ir = r.asInstanceOf[MakeArray]
        ir.args.head.typ == subsetTS("b")
      },
    )
  }

  @Test def testStreamTakeRebuild(): scalatest.Assertion = {
    checkRebuild(
      StreamTake(MakeStream(IndexedSeq(NA(ts)), TStream(ts)), I32(2)),
      TStream(subsetTS("b")),
      (_: BaseIR, r: BaseIR) => {
        val ir = r.asInstanceOf[StreamTake]
        ir.a.typ == TStream(subsetTS("b"))
      },
    )
  }

  @Test def testStreamDropRebuild(): scalatest.Assertion = {
    checkRebuild(
      StreamDrop(MakeStream(IndexedSeq(NA(ts)), TStream(ts)), I32(2)),
      TStream(subsetTS("b")),
      (_: BaseIR, r: BaseIR) => {
        val ir = r.asInstanceOf[StreamDrop]
        ir.a.typ == TStream(subsetTS("b"))
      },
    )
  }

  @Test def testStreamMapRebuild(): scalatest.Assertion = {
    checkRebuild(
      mapIR(MakeStream(IndexedSeq(NA(ts)), TStream(ts)))(x => x),
      TStream(subsetTS("b")),
      (_: BaseIR, r: BaseIR) => {
        val ir = r.asInstanceOf[StreamMap]
        ir.a.typ == TStream(subsetTS("b"))
      },
    )
  }

  @Test def testStreamGroupedRebuild(): scalatest.Assertion = {
    checkRebuild(
      StreamGrouped(MakeStream(IndexedSeq(NA(ts)), TStream(ts)), I32(2)),
      TStream(TStream(subsetTS("b"))),
      (_: BaseIR, r: BaseIR) => {
        val ir = r.asInstanceOf[StreamGrouped]
        ir.a.typ == TStream(subsetTS("b"))
      },
    )
  }

  @Test def testStreamGroupByKeyRebuild(): scalatest.Assertion = {
    checkRebuild(
      StreamGroupByKey(MakeStream(IndexedSeq(NA(ts)), TStream(ts)), FastSeq("a"), false),
      TStream(TStream(subsetTS("b"))),
      (_: BaseIR, r: BaseIR) => {
        val ir = r.asInstanceOf[StreamGroupByKey]
        ir.a.typ == TStream(subsetTS("a", "b"))
      },
    )
  }

  @Test def testStreamMergeRebuild(): scalatest.Assertion = {
    checkRebuild(
      StreamMultiMerge(
        IndexedSeq(
          MakeStream(IndexedSeq(NA(ts)), TStream(ts)),
          MakeStream(IndexedSeq(NA(ts)), TStream(ts)),
        ),
        FastSeq("a"),
      ),
      TStream(subsetTS("b")),
      (_: BaseIR, r: BaseIR) => r.typ == TStream(subsetTS("a", "b")),
    )
  }

  @Test def testStreamZipRebuild(): scalatest.Assertion = {
    val a2 = st.deepCopy()
    val a3 = st.deepCopy()
    for (
      b <- Array(
        ArrayZipBehavior.ExtendNA,
        ArrayZipBehavior.TakeMinLength,
        ArrayZipBehavior.AssertSameLength,
      )
    ) {
      checkRebuild(
        zipIR(
          FastSeq(st, a2, a3),
          b,
        ) { case Seq(foo, bar, _) =>
          bindIRs(
            GetField(foo, "b"),
            GetField(bar, "a"),
          )(_ => False())
        },
        TStream(TBoolean),
        (_: BaseIR, r: BaseIR) => r.asInstanceOf[StreamZip].as.length == 3,
        refEnv,
      )
    }
    checkRebuild(
      zipIR(
        FastSeq(st, a2, a3),
        ArrayZipBehavior.AssumeSameLength,
      ) { case Seq(foo, bar, _) =>
        bindIRs(
          GetField(foo, "b"),
          GetField(bar, "a"),
        )(_ => False())
      },
      TStream(TBoolean),
      (_: BaseIR, r: BaseIR) => r.asInstanceOf[StreamZip].as.length == 2,
      refEnv,
    )
  }

  @Test def testStreamFlatmapRebuild(): scalatest.Assertion = {
    checkRebuild(
      flatMapIR(MakeStream(IndexedSeq(NA(ts)), TStream(ts))) { x =>
        MakeStream(IndexedSeq(x), TStream(ts))
      },
      TStream(subsetTS("b")),
      (_: BaseIR, r: BaseIR) => {
        val ir = r.asInstanceOf[StreamFlatMap]
        ir.a.typ == TStream(subsetTS("b"))
      },
    )
  }

  @Test def testMakeStructRebuild(): scalatest.Assertion = {
    checkRebuild(
      MakeStruct(IndexedSeq("a" -> NA(TInt32), "b" -> NA(TInt64), "c" -> NA(TString))),
      subsetTS("b"),
      (_: BaseIR, r: BaseIR) =>
        r == MakeStruct(IndexedSeq("b" -> NA(TInt64))),
    )
  }

  @Test def testInsertFieldsRebuild(): scalatest.Assertion = {
    checkRebuild(
      InsertFields(NA(TStruct("a" -> TInt32)), IndexedSeq("b" -> NA(TInt64), "c" -> NA(TString))),
      subsetTS("b"),
      (_: BaseIR, r: BaseIR) => {
        val ir = r.asInstanceOf[InsertFields]
        ir.fields == IndexedSeq(
          "b" -> NA(TInt64)
        )
      },
    )

    /* Example needs to have field insertion that overwrites an unrequested field with a different
     * type. */
    val foo = Ref(freshName(), TStruct(("a", TInt32), ("b", TInt32)))
    val insertF = InsertFields(foo, IndexedSeq(("a", I64(8))))
    checkRebuild[InsertFields](
      insertF,
      TStruct(("b", TInt32)),
      (old, rebuilt) =>
        PruneDeadFields.isSupertype(rebuilt.typ, old.typ),
      BindingEnv.empty.bindEval(foo.name -> foo.typ),
    )
  }

  @Test def testMakeTupleRebuild(): scalatest.Assertion = {
    checkRebuild(
      MakeTuple(IndexedSeq(0 -> I32(1), 1 -> F64(1.0), 2 -> NA(TString))),
      TTuple(FastSeq(TupleField(2, TString))),
      (_: BaseIR, r: BaseIR) =>
        r == MakeTuple(IndexedSeq(2 -> NA(TString))),
    )
  }

  @Test def testSelectFieldsRebuild(): scalatest.Assertion = {
    checkRebuild(
      SelectFields(NA(ts), IndexedSeq("a", "b")),
      subsetTS("b"),
      (_: BaseIR, r: BaseIR) => {
        val ir = r.asInstanceOf[SelectFields]
        ir.fields == IndexedSeq("b")
      },
    )
  }

  @Test def testCastRenameRebuild(): scalatest.Assertion = {
    checkRebuild(
      CastRename(
        NA(TArray(TStruct("x" -> TInt32, "y" -> TString))),
        TArray(TStruct("y" -> TInt32, "z" -> TString)),
      ),
      TArray(TStruct("z" -> TString)),
      (_: BaseIR, r: BaseIR) => {
        val ir = r.asInstanceOf[CastRename]
        ir._typ == TArray(TStruct("z" -> TString))
      },
    )
  }

  val ndArrayTS = MakeNDArray(
    MakeArray(ArrayBuffer(NA(ts)), TArray(ts)),
    MakeTuple(IndexedSeq((0, I64(1L)))),
    True(),
    ErrorIDs.NO_ERROR,
  )

  @Test def testNDArrayMapRebuild(): scalatest.Assertion = {
    checkRebuild(
      ndMap(ndArrayTS)(x => x),
      TNDArray(subsetTS("b"), Nat(1)),
      (_: BaseIR, r: BaseIR) => {
        val ir = r.asInstanceOf[NDArrayMap]
        /* Even though the type I requested wasn't required, NDArrays always have a required element
         * type. */
        ir.nd.typ == TNDArray(TStruct(("b", TInt64)), Nat(1))
      },
    )
  }

  @Test def testNDArrayMap2Rebuild(): scalatest.Assertion = {
    checkRebuild(
      ndMap2(ndArrayTS, ndArrayTS)((l, _) => l),
      TNDArray(subsetTS("b"), Nat(1)),
      (_: BaseIR, r: BaseIR) => {
        val ir = r.asInstanceOf[NDArrayMap2]
        ir.l.typ == TNDArray(TStruct(("b", TInt64)), Nat(1))
        ir.r.typ == TNDArray(TStruct.empty, Nat(1))
      },
    )
    checkRebuild(
      ndMap2(ndArrayTS, ndArrayTS)((l, r) => r),
      TNDArray(subsetTS("b"), Nat(1)),
      (_: BaseIR, r: BaseIR) => {
        val ir = r.asInstanceOf[NDArrayMap2]
        ir.l.typ == TNDArray(TStruct.empty, Nat(1))
        ir.r.typ == TNDArray(TStruct(("b", TInt64)), Nat(1))
      },
    )
  }

  @Test def testCDARebuild(): scalatest.Assertion = {
    val ctxT = TStruct("a" -> TInt32, "b" -> TString)
    val globT = TStruct("c" -> TInt64, "d" -> TFloat64)
    val x = cdaIR(
      NA(TStream(ctxT)),
      NA(globT),
      "test",
      NA(TString),
    )((ctx, glob) => MakeTuple.ordered(FastSeq(ctx, glob)))

    val selectedCtxT = ctxT.typeAfterSelectNames(Array("a"))
    val selectedGlobT = globT.typeAfterSelectNames(Array("c"))
    checkRebuild(
      x,
      TArray(TTuple(selectedCtxT, selectedGlobT)),
      (_: BaseIR, r: BaseIR) => {
        r.isAlphaEquiv(
          ctx,
          cdaIR(
            NA(TStream(selectedCtxT)),
            NA(selectedGlobT),
            "test",
            NA(TString),
          )((ctx, glob) => MakeTuple.ordered(FastSeq(ctx, glob))),
        )
      },
    )
  }

  @Test def testTableAggregateRebuild(): scalatest.Assertion = {
    val ta = TableAggregate(tr, ApplyAggOp(PrevNonnull())(tableRefBoolean(tr.typ, "row.2")))
    checkRebuild(
      ta,
      TBoolean,
      (_: BaseIR, r: BaseIR) => {
        val ir = r.asInstanceOf[TableAggregate]
        ir.child.typ == subsetTable(tr.typ, "row.2")
      },
    )
  }

  @Test def testTableCollectRebuild(): scalatest.Assertion = {
    val tc = TableCollect(TableKeyBy(tab, FastSeq()))
    checkRebuild(
      tc,
      TStruct("global" -> TStruct("g1" -> TInt32)),
      (_: BaseIR, r: BaseIR) =>
        r.asInstanceOf[MakeStruct].fields.head._2.isInstanceOf[TableGetGlobals],
    )

    checkRebuild(
      tc,
      TStruct.empty,
      (_: BaseIR, r: BaseIR) =>
        r == MakeStruct(IndexedSeq()),
    )
  }

  @Test def testMatrixAggregateRebuild(): scalatest.Assertion = {
    val ma = MatrixAggregate(mr, ApplyAggOp(Collect())(matrixRefBoolean(mr.typ, "va.r2")))
    checkRebuild(
      ma,
      TBoolean,
      (_: BaseIR, r: BaseIR) => {
        val ir = r.asInstanceOf[MatrixAggregate]
        ir.child.typ == subsetMatrixTable(mr.typ, "va.r2")
      },
    )
  }

  @Test def testPipelineLetRebuild(): scalatest.Assertion = {
    val t = TStruct("a" -> TInt32)
    val foo = freshName()
    checkRebuild(
      RelationalLet(foo, NA(t), RelationalRef(foo, t)),
      TStruct.empty,
      (_: BaseIR, r: BaseIR) =>
        r.asInstanceOf[RelationalLet].body == RelationalRef(foo, TStruct.empty),
    )
  }

  @Test def testPipelineLetTableRebuild(): scalatest.Assertion = {
    val t = TStruct("a" -> TInt32)
    val foo = freshName()
    checkRebuild(
      RelationalLetTable(foo, NA(t), TableMapGlobals(tab, RelationalRef(foo, t))),
      tab.typ.copy(globalType = TStruct.empty),
      (_: BaseIR, r: BaseIR) =>
        r.asInstanceOf[RelationalLetTable].body.asInstanceOf[
          TableMapGlobals
        ].newGlobals == RelationalRef(foo, TStruct.empty),
    )
  }

  @Test def testPipelineLetMatrixTableRebuild(): scalatest.Assertion = {
    val t = TStruct("a" -> TInt32)
    val foo = freshName()
    checkRebuild(
      RelationalLetMatrixTable(foo, NA(t), MatrixMapGlobals(mat, RelationalRef(foo, t))),
      mat.typ.copy(globalType = TStruct.empty),
      (_: BaseIR, r: BaseIR) =>
        r.asInstanceOf[RelationalLetMatrixTable].body.asInstanceOf[
          MatrixMapGlobals
        ].newGlobals == RelationalRef(foo, TStruct.empty),
    )
  }

  @Test def testIfUnification(): scalatest.Assertion = {
    val pred = False()
    val t = TStruct("a" -> TInt32, "b" -> TInt32)
    val pruneT = TStruct("a" -> TInt32)
    val cnsq = Ref(freshName(), t)
    val altr = NA(t)
    val ifIR = If(pred, cnsq, altr)
    val memo = Memo.empty[BaseType]
      .bind(pred, TBoolean)
      .bind(cnsq, pruneT)
      .bind(altr, pruneT)
      .bind(ifIR, pruneT)

    // should run without error!
    PruneDeadFields.rebuildIR(
      ctx,
      ifIR,
      BindingEnv.empty[Type].bindEval(freshName(), t),
      PruneDeadFields.RebuildMutableState(memo, mutable.HashMap.empty),
    )

    scalatest.Succeeded
  }

  @DataProvider(name = "supertypePairs")
  def supertypePairs: Array[Array[Type]] = Array(
    Array(TInt32, TInt32),
    Array(
      TStruct(
        "a" -> TInt32,
        "b" -> TArray(TInt64),
      ),
      TStruct(
        "a" -> TInt32,
        "b" -> TArray(TInt64),
      ),
    ),
    Array(TSet(TString), TSet(TString)),
  )

  @Test(dataProvider = "supertypePairs")
  def testIsSupertypeRequiredness(t1: Type, t2: Type): scalatest.Assertion =
    assert(
      PruneDeadFields.isSupertype(t1, t2),
      s"""Failure, supertype relationship not met
         | supertype: ${t1.toPrettyString(true)}
         | subtype:   ${t2.toPrettyString(true)}""".stripMargin,
    )

  @Test def testApplyScanOp(): scalatest.Assertion = {
    val x = Ref(freshName(), TInt32)
    val y = Ref(freshName(), TInt32)
    val env = BindingEnv.empty.createScan.bindScan(x.name -> x.typ, y.name -> y.typ)

    val collectScan = ApplyScanOp(Collect())(MakeStruct(FastSeq(("x", x), ("y", y))))
    checkRebuild(
      collectScan,
      TArray(TStruct("y" -> TInt32)),
      (_: BaseIR, reb: BaseIR) => reb.typ == TArray(TStruct("y" -> TInt32)),
      env,
    )

    val takeScan = ApplyScanOp(Take(), I32(1))(MakeStruct(FastSeq(("x", x), ("y", y))))
    checkRebuild(
      takeScan,
      TArray(TStruct("y" -> TInt32)),
      (_: BaseIR, reb: BaseIR) => reb.typ == TArray(TStruct("y" -> TInt32)),
      env,
    )

    val prevnn = ApplyScanOp(PrevNonnull())(MakeStruct(FastSeq(("x", x), ("y", y))))
    checkRebuild(
      prevnn,
      TStruct("y" -> TInt32),
      (_: BaseIR, reb: BaseIR) => reb.typ == TStruct("y" -> TInt32),
      env,
    )

    val takeByScan = ApplyScanOp(TakeBy(), I32(1))(
      MakeStruct(FastSeq(("x", x), ("y", y))),
      MakeStruct(FastSeq(("x", x), ("y", y))),
    )
    checkRebuild(
      takeByScan,
      TArray(TStruct("y" -> TInt32)),
      { (_: BaseIR, reb: BaseIR) =>
        val s = reb.asInstanceOf[ApplyScanOp]
        s.seqOpArgs == FastSeq(
          MakeStruct(FastSeq(("y", y))),
          MakeStruct(FastSeq(("x", x), ("y", y))),
        )
      },
      env,
    )
  }

  @Test def testApplyAggOp(): scalatest.Assertion = {
    val x = Ref(freshName(), TInt32)
    val y = Ref(freshName(), TInt32)
    val env = BindingEnv.empty.createAgg.bindAgg(x.name -> x.typ, y.name -> y.typ)

    val collectAgg = ApplyAggOp(Collect())(MakeStruct(FastSeq(("x", x), ("y", y))))
    checkRebuild(
      collectAgg,
      TArray(TStruct("y" -> TInt32)),
      (_: BaseIR, reb: BaseIR) => reb.typ == TArray(TStruct("y" -> TInt32)),
      env,
    )

    val takeAgg = ApplyAggOp(Take(), I32(1))(MakeStruct(FastSeq(("x", x), ("y", y))))
    checkRebuild(
      takeAgg,
      TArray(TStruct("y" -> TInt32)),
      (_: BaseIR, reb: BaseIR) => reb.typ == TArray(TStruct("y" -> TInt32)),
      env,
    )

    val prevnn = ApplyAggOp(PrevNonnull())(MakeStruct(FastSeq(("x", x), ("y", y))))
    checkRebuild(
      prevnn,
      TStruct("y" -> TInt32),
      (_: BaseIR, reb: BaseIR) => reb.typ == TStruct("y" -> TInt32),
      env,
    )

    val takeByAgg = ApplyAggOp(TakeBy(), I32(1))(
      MakeStruct(FastSeq(("x", x), ("y", y))),
      MakeStruct(FastSeq(("x", x), ("y", y))),
    )
    checkRebuild(
      takeByAgg,
      TArray(TStruct("y" -> TInt32)),
      { (_: BaseIR, reb: BaseIR) =>
        val a = reb.asInstanceOf[ApplyAggOp]
        a.seqOpArgs == FastSeq(
          MakeStruct(FastSeq(("y", y))),
          MakeStruct(FastSeq(("x", x), ("y", y))),
        )
      },
      env,
    )
  }

  @Test def testStreamFold2(): scalatest.Assertion = {
    val eltType = TStruct("a" -> TInt32, "b" -> TInt32)
    val accum1Type = TStruct("c" -> TInt32, "d" -> TInt32)

    val ir0 = fold2IR(NA(TStream(eltType)), NA(accum1Type)) {
      case (elt, Seq(acc)) =>
        MakeStruct(FastSeq("c" -> GetField(elt, "a"), "d" -> GetField(acc, "c")))
    } { case Seq(acc) => acc }

    def checker(original: IR, rebuilt: IR): Boolean = {
      val r = rebuilt.asInstanceOf[StreamFold2]
      r.typ == TStruct("c" -> TInt32)
      r.a.typ == TStream(TStruct("a" -> TInt32))
      r.accum(0)._2.typ == r.typ
    }

    checkRebuild(ir0, TStruct("c" -> TInt32), checker)
  }
}
