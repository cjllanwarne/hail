package is.hail.types.virtual

import is.hail.annotations._
import is.hail.backend.HailStateManager
import is.hail.macros.void
import is.hail.utils._
import is.hail.variant._

object TLocus {
  val representation: TStruct =
    TStruct(
      "contig" -> TString,
      "position" -> TInt32,
    )

  def schemaFromRG(rg: Option[String], required: Boolean = false): Type = rg match {
    // must match tlocus.schema_from_rg
    case Some(name) => TLocus(name)
    case None => TLocus.representation
  }
}

case class TLocus(rgName: String) extends Type {

  def _toPretty = s"Locus($rgName)"

  def rg: String = rgName

  override def pyString(sb: StringBuilder): Unit =
    void(sb ++= "locus<" ++= prettyIdentifier(rgName) += '>')

  def _typeCheck(a: Any): Boolean = a.isInstanceOf[Locus]

  override def mkOrdering(sm: HailStateManager, missingEqual: Boolean = true): ExtendedOrdering =
    sm.referenceGenomes(rgName).extendedLocusOrdering

  lazy val representation: TStruct = TLocus.representation

  def locusOrdering(sm: HailStateManager): Ordering[Locus] =
    sm.referenceGenomes(rgName).locusOrdering

  override def unify(concrete: Type): Boolean = concrete match {
    case TLocus(crgName) => rgName == crgName
    case _ => false
  }

  override def isIsomorphicTo(t: Type): Boolean =
    t match {
      case l: TLocus => rgName == l.rgName
      case _ => false
    }
}
